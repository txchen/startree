# Cloudflare Access and Client Cache Research

Research date: 2026-08-17

## Question

How do Cloudflare Access authentication, session behavior, Worker protection, browser and edge caching, service workers, and read-only offline data interact for a private single-user site, including use from a managed company laptop without an extension?

## Executive summary

The intended architecture is feasible on Cloudflare without a browser extension. A public HTTPS hostname can be protected by a clientless Cloudflare Access application, and current Workers integration can protect a Worker, all of its domains, or a specific hostname. Cloudflare states that every request is checked by Access before the Worker runs. An allow policy should match only the owner's exact identity.

Use edge caching only for identical static application assets. Do not put bookmark or dashboard API responses into a shared cache: return `Cache-Control: private, no-store` and keep their authoritative copy in server-side storage. A small browser-side snapshot can provide the requested read-only offline behavior, but that snapshot has a different security boundary. When a service worker or application reads local data without making a network request, Cloudflare Access cannot authenticate, expire, revoke, or log that read. Offline data therefore remains available to anyone who can use that browser profile until the application or browser clears it.

The simplest robust design is:

- one Worker, protected at the Worker level or on its sole custom hostname by Access;
- an exact-user Allow policy and no public alternate route;
- hashed static assets served through Workers Static Assets and cached globally;
- uncached, authenticated JSON API responses for private data;
- a service worker for the application shell plus a versioned, read-only bookmark snapshot in IndexedDB;
- network-first startup, with a clearly marked offline fallback and explicit local-data clearing;
- no dependency on service-worker persistence for normal online operation.

One product decision remains: whether the convenience of an unencrypted offline bookmark snapshot is acceptable on a company-managed laptop. If it is not, read-only offline data should be disabled there or protected by a separate user-entered secret; Access alone cannot protect data while offline.

## Findings

### Managed-laptop browser use

A self-hosted public Access application places authentication in front of an Internet-reachable HTTPS hostname. It is clientless: the browser follows the Access login flow and presents Access cookies on later requests. Cloudflare One Client is relevant to private network destinations or device-posture requirements, but is not required for a public hostname. This means the site can work in a normal managed browser without an extension, assuming company browser and network policy permit the hostname, redirects, cookies, JavaScript, and local storage.[^access-public][^worker-access]

This avoids the extension-installation constraint, but it cannot bypass enterprise controls. A managed browser may restrict cookies or site storage, clear storage at shutdown, or block the site. The application should therefore remain fully functional as an online web application when service workers or persistent storage are unavailable, and the actual company laptop should be included in acceptance testing.

For the single-user policy, prefer an exact email or Cloudflare account identity over an email-domain rule. Domain-wide access is broader than the stated requirement. Device posture would require additional managed-device integration and is not necessary merely to use a public Access-protected site.

### Access sessions and requests

Access checks every HTTP request to the protected site for a valid `CF_Authorization` cookie and blocks requests without one. It issues a global token on the Cloudflare team domain for SSO and an application token on the protected hostname.[^authorization-cookie]

The application token duration is controlled by the matching policy, falling back to the application duration; the global token has its own duration. Both default to 24 hours when not configured. Current documented ranges extend from immediate expiry or 15 minutes, depending on the setting, to one month. When an application token expires while the global token is still valid, Access can issue a new application token after rechecking the stored identity against policy. Only when the global token has also expired must the browser reauthenticate with the identity provider.[^session-management]

This allows a long global session for low-friction SSO and a shorter application/policy session for more frequent authorization checks. Exact durations remain a security-versus-convenience choice. For a frequently opened personal start page, a multi-day global session plus a shorter application session is a reasonable starting point, followed by validation on the managed browser.

For single-page application API calls, Access can return `401` instead of an HTML login response when the request includes `X-Requested-With: XMLHttpRequest`. The client should handle that response by refreshing or showing a session-expired message.[^session-management]

Access logout or administrator revocation invalidates online Access tokens, but does not clear application-managed IndexedDB or Cache Storage. An application-owned “clear local data and log out” action must clear local data first and then navigate to the Access logout endpoint.

### Protecting the Worker

Current Workers documentation supports Access at three useful scopes: an entire Worker (covering its routes, custom domains, `workers.dev`, and previews), a specific hostname/path, or all Workers in an account. Cloudflare explicitly states that every request is checked before the Worker runs.[^worker-access]

Worker-level protection is the safest default for this project because it reduces the chance of leaving a secondary deployment hostname public. If hostname-level protection is chosen instead, disable or separately protect `workers.dev` and preview URLs. Access policies are default-deny, so only the explicit owner identity should receive Allow.

The Worker can read the authenticated identity through `ctx.access`; it is `undefined` when Access did not authenticate the request. The Worker should reject such a request as defense in depth and use the identity only after Access has authenticated it.[^worker-access] If an origin outside the direct Workers integration is ever introduced, validate the Access JWT signature, issuer, and audience at that origin rather than trusting the presence of a header alone.[^application-token]

### Edge caching and browser HTTP caching

Workers Static Assets are deployed across Cloudflare's network and automatically cached, including tiered retrieval on a cache miss. They are appropriate for the HTML/JavaScript/CSS application shell and other content that is identical for every authorized request.[^static-assets]

Cloudflare distinguishes edge caching from browser caching. The response `Cache-Control` header controls browser behavior, while Workers and zone cache settings control shared edge behavior. For normal zone caching, `private` and `no-store` prevent Cloudflare from caching a response; `Set-Cookie` commonly causes a bypass as well.[^cache-responses][^worker-cache]

The safe policy split is:

| Content | Edge policy | Browser policy | Reason |
| --- | --- | --- | --- |
| Fingerprinted JS, CSS, fonts, and images | Long-lived public cache | Long-lived immutable cache | Content is identical and the URL changes with content. |
| HTML application entry point | Revalidate, or use a short lifetime | Revalidate | Allows prompt rollout of a new asset manifest. |
| Bookmark and dashboard API responses | Do not store in a shared cache | `private, no-store` | Data is private and mutable; explicit offline storage is handled separately. |
| Mutations | Never cache | Never cache | Writes must reach the Worker and authoritative store. |

Do not vary a shared response only by Access cookie unless the cache key is deliberately partitioned and audited. This application has one user, so caching private API data at the edge offers little benefit and creates unnecessary exposure and invalidation complexity. Access still gates online requests, but it should not be treated as a reason to place private response bodies in a globally shared cache.

Static-asset edge caching and Access solve different problems: Access authorizes each online request; the cache avoids static asset generation and transfer work. The dominant dynamic startup request should stay small, and the client can render its last local snapshot immediately while refreshing it online.

### Service workers and read-only offline data

A service worker runs only in a secure context and may intercept fetches within its scope. Its fetch handler can return a locally stored response instead of using the network; Cache Storage persists request/response pairs for this purpose.[^service-workers][^cache-api]

Consequently, an offline response served by a service worker never reaches Cloudflare. This yields an important security inference from the Access and service-worker request models:

> Cloudflare Access protects online requests, not local offline copies. An expired or revoked Access session cannot invalidate data already stored in the browser.

Use a service worker to cache only the versioned application shell. Store structured bookmark data as a versioned snapshot in IndexedDB rather than relying on HTTP cache semantics. On successful authenticated refresh, atomically replace the snapshot and record its server revision and refresh timestamp. On startup:

1. render the local snapshot if present;
2. request current data from the protected API;
3. replace the snapshot after a successful authenticated response;
4. if the network fails, keep the UI explicitly read-only and label it with the last refresh time;
5. never queue mutations for later replay in V1.

Browser storage is best-effort by default and may be evicted. A site can request persistent storage with `navigator.storage.persist()`, but the browser decides whether to grant it. The application must tolerate missing or cleared storage and must never treat the offline snapshot as a backup or authoritative copy.[^storage-standard][^storage-persist]

An application logout control should delete the IndexedDB snapshot and application Cache Storage before navigating to Access logout. Also provide a standalone “clear offline data” action. These controls reduce retention but cannot guarantee erasure if the page cannot run; browser or device administrators retain control of local storage.

Encrypting the snapshot with a key stored alongside it does not materially protect against someone who can use the same browser profile. Meaningful offline encryption requires a secret not automatically available to that profile, such as a passphrase entered after restart. That adds friction to a start page, so it should be an explicit product choice rather than an assumed implementation detail.

## Decision implications

The following facts are stable enough for later architecture decisions:

1. **Access fits the no-extension constraint.** Use a public HTTPS hostname and clientless Access rather than a private-network application.
2. **Protect the full deployment surface.** Prefer Worker-level Access, or audit and disable every alternate hostname when using hostname-level Access.
3. **Separate shell performance from private-data caching.** Cache static assets globally; keep private APIs out of shared and HTTP browser caches.
4. **Offline is a local trust decision.** Access cannot enforce session expiry or revocation against an offline snapshot.
5. **Offline must be optional and disposable.** Treat the snapshot as best-effort acceleration, not authoritative data or backup.
6. **Keep V1 conflict-free.** Read-only offline mode avoids sync queues, conflict resolution, and stale writes.
7. **Validate on the real managed browser.** Cookie, redirect, service-worker, and persistence behavior can be constrained by enterprise policy.

## Newly surfaced decision questions

1. Is it acceptable for bookmark titles and URLs to remain readable in the managed browser profile after the Access session expires, until local site data is cleared?
2. If not, should offline snapshots be disabled on that device, or should the product accept a separate passphrase/encryption flow?
3. What global and application/policy session durations provide the preferred balance between a near-instant daily start page and exposure from an unattended logged-in browser?
4. Should production use Worker-level Access for all routes and previews, or hostname-level Access with all alternate deployment URLs disabled?

## Sources

All sources are current first-party documentation or standards retrieved on the research date.

[^access-public]: Cloudflare, [Publish a self-hosted application to the Internet](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/).
[^worker-access]: Cloudflare, [Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).
[^authorization-cookie]: Cloudflare, [Authorization cookie](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/).
[^session-management]: Cloudflare, [Session management in Access](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/).
[^application-token]: Cloudflare, [Application token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/).
[^static-assets]: Cloudflare, [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/).
[^cache-responses]: Cloudflare, [Cloudflare cache responses](https://developers.cloudflare.com/cache/concepts/cache-responses/).
[^worker-cache]: Cloudflare, [How the cache works with Workers](https://developers.cloudflare.com/workers/reference/how-the-cache-works/).
[^service-workers]: W3C, [Service Workers](https://www.w3.org/TR/service-workers/).
[^cache-api]: W3C Service Workers specification, [Cache interface](https://www.w3.org/TR/service-workers/#cache-interface).
[^storage-standard]: WHATWG, [Storage Standard](https://storage.spec.whatwg.org/).
[^storage-persist]: Mozilla, [`StorageManager.persist()`](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist).
