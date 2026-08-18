# Cloudflare Runtime and Storage Options

Research date: 2026-08-17

## Question

Which current Cloudflare runtime, static asset, and persistence options can support a private, single-user personal start page, and which trade-offs should later architecture decisions account for?

The expected workload is a small single-page application with bookmark browsing, search, editing, ordering, and future dashboard modules. The server is the authoritative data source; a browser cache may accelerate reads and allow read-only use when offline.

## Recommendation

Use one **Cloudflare Worker with Workers Static Assets** for the application shell and JSON API, backed by **one D1 database** as the authoritative bookmark store. Keep static asset requests on the direct asset path and invoke Worker code only for API routes. Start without KV, R2, Durable Objects, or D1 read replication. Add **scheduled D1 exports to R2** if recovery beyond D1 Time Travel's retention window is required.

This combination is sufficient for the stated V1 and leaves room for future dashboard modules. No material platform limitation forces reconsidering Cloudflare for this workload.

The main architecture decisions that remain are:

1. whether the seven-day point-in-time recovery window on the Free plan is sufficient or the project should pay at least $5 per month for the Paid plan and its 30-day window;
2. where to place the D1 primary relative to the user's usual location, and whether measured read latency later justifies D1 read replication;
3. how often to export D1 to R2, how long to retain exports, and how to test restoration; and
4. whether authentication must run before every static asset request or can remain an outer Cloudflare Access policy, because Worker-first asset routing changes request billing and failure behavior.

## Runtime and static assets

### Preferred: Workers Static Assets plus a Worker API

Workers Static Assets deploys the Worker code and front-end assets as one versioned unit, caches the assets on Cloudflare's network, and serves requests from locations close to users.[^static-assets] Static asset requests are free and unlimited, and storing deployed assets has no additional charge; only requests that invoke Worker code use Workers billing.[^asset-billing] This fits a SPA whose hashed JavaScript, CSS, and icons are static while `/api/*` is dynamic.

Routing should keep assets ahead of the Worker and selectively run the Worker for API paths. Cloudflare's Workers migration guidance says Workers serve static assets before Worker code by default; `run_worker_first` is needed when authentication or other logic must execute before assets.[^pages-migration] On the Free plan, a Worker-first request that exhausts the Worker request allowance returns `429` rather than falling back to the asset.[^asset-billing] The later security design therefore needs to decide whether Cloudflare Access at the hostname boundary is sufficient without Worker-first routing.

The current Free plan allows 100,000 Worker requests per day and 10 ms CPU per invocation. The Paid plan has a $5 monthly account minimum, includes 10 million requests and 30 million CPU milliseconds per month, and charges $0.30 per additional million requests and $0.02 per additional million CPU milliseconds. Static asset requests remain free and unlimited.[^workers-pricing] A personal start page should fit comfortably within the Free allowances if static assets bypass Worker code and API handlers remain small. A Free-plan quota is a hard availability boundary, however, not merely a billing threshold.

Workers impose 128 MB of memory per isolate. Static assets are limited to 20,000 files per Worker version on Free and 100,000 on Paid, with a 25 MiB limit per asset.[^workers-limits] These constraints are far above the expected application shell. Heavy server-side rendering, image processing, or bulk import should not be put on the start-page request path, but none is needed for V1.

### Plausible alternative: Pages plus Pages Functions

Pages can host the SPA and Pages Functions can access D1, KV, and R2, so it is technically viable. Pages Functions are billed as Workers.[^pages-functions-pricing] Cloudflare now documents migration from Pages to Workers, notes that the cost structure is similar, and states that Workers exposes a broader feature set, including Durable Objects, Cron Triggers, and more comprehensive observability.[^pages-migration] For a new full-stack application with an API and likely scheduled backup work, Pages adds a second project model without a compensating runtime or cost advantage. It should not be the default.

## Authoritative persistence

### Preferred: D1

D1 is a managed serverless database with SQLite semantics, Worker bindings, and built-in point-in-time recovery.[^d1-overview] The bookmark model needs relational operations and atomic changes across bookmarks, collections, ordering, and future module configuration. SQL constraints, indexes, and transactional D1 batches make D1 a better authority than a cached key-value snapshot or object store.[^d1-api]

The Free plan includes 5 million rows read and 100,000 rows written per day plus 5 GB of total storage. Paid includes 25 billion rows read, 50 million rows written, and 5 GB per month before overage; D1 scales to zero and has no data-transfer charge.[^d1-pricing] An individual Free database is limited to 500 MB; Paid raises that to 10 GB. Each database is single-threaded, but indexed point queries have sub-millisecond SQL duration in Cloudflare's guidance, and throughput scales inversely with query duration.[^d1-limits] Bookmark data for one user is unlikely to approach either the capacity or concurrency ceiling. Search and ordering columns should still be indexed so latency and row-read billing do not grow with full table scans.

Without read replication, D1 routes reads and writes to one primary database location, so network round-trip time to that location dominates remote API latency. Read replication creates asynchronous read-only copies in multiple regions, but writes still go to the primary. Applications must use the D1 Sessions API to use replicas and obtain sequential consistency; carrying a session bookmark lets a later request read a database version at least as current as the earlier session.[^d1-replication] For one user who typically works in one geography, the simplest initial choice is a nearby primary and no replicas. Browser-side cached data can render immediately while the API refreshes. Replication should be enabled only after measurement shows that cross-region database reads are an actual bottleneck.

### Recovery and independent backups

D1 Time Travel is always enabled and restores to any minute in the retained window. The window is seven days on Workers Free and 30 days on Workers Paid.[^d1-time-travel][^d1-limits] A restore overwrites the database in place, though Cloudflare returns a bookmark that can undo the restoration; Time Travel does not yet clone or fork the database.[^d1-time-travel]

Time Travel protects against recent accidental writes or migrations but is not a complete long-retention backup strategy. Cloudflare documents automated D1 export to R2 through the REST API and Workflows for retention beyond 30 days.[^d1-time-travel] D1 can also export SQL through Wrangler, but a running export blocks other database requests.[^d1-export] A small single-user database can tolerate an off-hours export, but the architecture should specify frequency, retention, encryption/access policy, restore drills, and whether exports must leave the Cloudflare account to cover account-level loss.

## Other persistence options

### Workers KV: cache only, not authority

KV stores data centrally and caches accessed values around Cloudflare's network. Hot reads are low latency, but cold reads fall back through regional and central tiers.[^kv-how] Its reads are eventually consistent: changes may take 60 seconds or more to become visible in other locations, previously missing keys are cached too, and KV does not provide the atomic operations or read/write transactions needed by this data model.[^kv-how]

KV is therefore a poor authoritative store for interactive edits and drag ordering. A user could save a bookmark and then see an older collection snapshot from another location. It could later hold derived, replaceable, read-heavy snapshots, but client-side caching already serves that purpose without another invalidation system. Omitting KV from V1 reduces both complexity and stale-data failure modes.

If introduced later, its Free allowance is 100,000 key reads and 1,000 writes per day with 1 GB stored; exceeding an operation allowance causes further operations of that type to fail. Paid includes 10 million reads, 1 million writes, and 1 GB per month before overage.[^kv-pricing]

### R2: backup and large-object store, not bookmark database

R2 offers strong global consistency for object reads, writes, deletes, metadata changes, and listings through its direct APIs.[^r2-consistency] It is appropriate for D1 export files and future user-owned binary assets. However, it provides object operations rather than relational queries or multi-record transactions, so using a JSON object as the bookmark authority would require custom concurrency control, indexing, and migration logic.

R2 Standard includes 10 GB-month, 1 million Class A operations, and 10 million Class B operations per month for free. Beyond that, Standard storage is $0.015 per GB-month, Class A operations are $4.50 per million, Class B operations are $0.36 per million, and Internet egress is free.[^r2-pricing] This makes retained D1 exports effectively free at personal scale. Direct R2 operations are strongly consistent, but serving an R2 custom domain through cache intentionally relaxes visibility until cache expiry or purge; backup code should use the Worker binding or S3 API rather than treating a cached public URL as authoritative.[^r2-consistency]

### Durable Objects: unnecessary for V1

Cloudflare positions Durable Objects for global coordination, stateful serverless systems, real-time applications, and strongly consistent transactional storage.[^storage-options] The stated single-user CRUD workload does not need those capabilities, and D1 already provides the SQL model and recovery tooling it needs. Introducing a Durable Object would add another data model and operational surface without solving a current constraint. Revisit only if future modules require live coordination or D1 contention is demonstrated.

## Latency and caching implications

The fastest initial render should not wait for a database query:

1. serve versioned SPA assets directly through Workers Static Assets;
2. let the client render its last validated data snapshot immediately when present;
3. refresh from the Worker API in parallel; and
4. update or invalidate the client snapshot after successful mutations.

This design makes static delivery globally fast and keeps D1 latency off the visual critical path for returning clients. Cached private data must be treated as a client-side copy, not an independent authority. Offline mode can remain read-only, avoiding write conflict resolution. Worker or CDN response caching of user-specific API payloads should be avoided initially because there is only one user and invalidation complexity outweighs its benefit.

## Platform viability and reconsideration triggers

Cloudflare is viable for V1. The expected data and traffic are orders of magnitude below published limits, the runtime and relational store integrate directly, static delivery is globally cached, and an independent backup path exists.

Reconsider the platform or storage design only if measurement or scope changes reveal one of these conditions:

- writes need consistently low latency from regions far from the D1 primary, because read replicas do not accelerate writes;
- one authoritative database must exceed D1's fixed 10 GB Paid limit;
- future workloads need sustained write concurrency that conflicts with D1's single-threaded database model;
- regulatory or organizational requirements demand backup independence or recovery guarantees beyond Time Travel plus exported snapshots; or
- a future offline-write requirement introduces multi-device conflict resolution that the current server-authoritative model deliberately excludes.

None of these conditions is present in the stated single-user bookmark-first V1.

## Sources

[^static-assets]: Cloudflare, [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/).
[^asset-billing]: Cloudflare, [Static Assets: Billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).
[^pages-migration]: Cloudflare, [Migrate from Pages to Workers](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/).
[^workers-pricing]: Cloudflare, [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).
[^workers-limits]: Cloudflare, [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
[^pages-functions-pricing]: Cloudflare, [Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/).
[^d1-overview]: Cloudflare, [Cloudflare D1](https://developers.cloudflare.com/d1/).
[^d1-api]: Cloudflare, [D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/).
[^d1-pricing]: Cloudflare, [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).
[^d1-limits]: Cloudflare, [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
[^d1-replication]: Cloudflare, [D1 global read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/).
[^d1-time-travel]: Cloudflare, [D1 Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/).
[^d1-export]: Cloudflare, [Import and export D1 data](https://developers.cloudflare.com/d1/best-practices/import-export-data/).
[^kv-how]: Cloudflare, [How Workers KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/).
[^kv-pricing]: Cloudflare, [Workers KV pricing](https://developers.cloudflare.com/kv/platform/pricing/).
[^r2-consistency]: Cloudflare, [R2 consistency model](https://developers.cloudflare.com/r2/reference/consistency/).
[^r2-pricing]: Cloudflare, [R2 pricing](https://developers.cloudflare.com/r2/pricing/).
[^storage-options]: Cloudflare, [Workers storage options](https://developers.cloudflare.com/workers/platform/storage-options/).
