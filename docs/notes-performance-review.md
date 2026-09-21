# Notes loading and startup review

Baseline: `491fae3`, immediately before encrypted Notes. The Owner required Notes to load on demand and preserve Bookmark startup performance.

## Loading design

The default Page still imports Bookmarks directly. Notes is a dynamic Vue component import, including its CSS, session state, encryption, validation, and persistence. The app shell only adds centered navigation, a loading/error state, safe departure, and a logout hook. The logout hook also imports Notes storage lazily rather than initializing it on startup.

Workbox precaching explicitly excludes `NotesPage-*` and `notes-storage-*`. A runtime cache retains these hashed code/style assets only after use. The initial precache remains five entries. No Notes database, cryptographic derivation, network polling, or API fetch starts while browsing Bookmarks. Notes checks for sync while open and unlocked only.

`node scripts/verify-notes-loading.mjs` enforces the dynamic import boundary, excludes Notes assets from the service-worker manifest, rejects PBKDF2 in the Bookmark entry, and caps entry gzip growth at 3 KiB above baseline. Browser acceptance observes actual requests with the service worker installed and rejects eager Notes requests. The script is part of required release verification.

## Measurements

The unchanged `scripts/measure-startup.mjs` harness uses the production build, a synthetic 10,000-Bookmark/1,000-Folder library, real IndexedDB and search Worker, five fresh browser contexts, and a retained reload for each context. Times are medians until the first Folder tile appears, not production LCP. Service workers are blocked for these timing samples; the separate browser acceptance covers the real service-worker loading boundary. Local HTTP excludes Cloudflare Access, D1, and public-network latency. Small differences below are normal local timing variation, not evidence of a speed improvement.

| Measurement                       |     Baseline |   With Notes |
| --------------------------------- | -----------: | -----------: |
| Cold first Folder                 |     457.2 ms |     440.0 ms |
| Retained first Folder             |     255.1 ms |     249.9 ms |
| Bookmark entry, gzip              | 48,364 bytes | 49,864 bytes |
| Bookmark CSS, gzip (build output) | about 4.9 KB | about 5.1 KB |
| Eager Notes JS/CSS requests       |            0 |            0 |
| Eager Notes API requests          |            0 |            0 |
| Precache entries                  |            5 |            5 |

The Bookmark entry increases by 1,500 gzip bytes (about 3.1%). No startup regression was observed in this sample. The new Notes screen and storage chunks are loaded only on demand, approximately 10 KB combined gzip for JavaScript plus 1.7 KB of Notes CSS after adding manual saves and version history. No runtime dependencies were added.

The same delayed-search-index diagnostic remains available in the harness. With Notes, the 1-second delayed-index run reached the first Folder at a median 424.5 ms, showing that index readiness still does not gate browsing.

Repeat after building:

```sh
npm run build
node scripts/verify-notes-loading.mjs
node scripts/measure-startup.mjs
```

Timing is diagnostic evidence, not a flaky single-run CI threshold. Bundle and request-boundary checks are deterministic release requirements.
