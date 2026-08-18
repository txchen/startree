# Operations

Startree has local, preview, and production environments. Their Worker names and D1 database names are deliberately distinct. Deployments run only from the Owner's authenticated local machine; CI never receives Cloudflare credentials, contacts remote D1, or deploys.

## Access prerequisite

Before the first remote release, configure Cloudflare Access to protect the entire `startree-preview.<account-subdomain>.workers.dev` application and the entire `startree.txchen.win` application. Policies must include every path, including `/api/*`, and allow only the Owner. Production disables both `workers.dev` and version preview URLs in `wrangler.jsonc`; preview disables per-version preview URLs so its fixed, Access-protected hostname is the only preview surface.

Verify both Access applications and their policies in Zero Trust before every first deployment or hostname change. Do not deploy an environment when its whole-application Access policy is absent.

From a browser without an Access session, verify `/`, `/bookmarks`, `/api/v1/platform`, `/api/bookmarks/snapshot`, `/api/bookmarks/trash`, and `/api/bookmarks/commands`. Every request must enter the Access login flow and none may expose an application response. Repeat against every configured custom domain and fixed `workers.dev` hostname. In the Workers dashboard, confirm that preview version URLs are disabled and that production has both version URLs and `workers.dev` disabled. A redirect or denial from a nonexistent production surface is expected before the first production release; application content is not.

API responses must not include `Access-Control-Allow-Origin` or `Access-Control-Allow-Credentials`. A command sent with a foreign or absent `Origin` must return the structured `invalid_origin` response after Access authentication. Never copy Access cookies, assertions, identity headers, or request bodies into tickets or logs.

## Local development

Install dependencies, apply migrations, and start the combined Worker:

```sh
vp install
vp run db:migrate:local
vp run dev:worker
```

Wrangler serves the built Vue client and Hono API together. Use `vp dev` when only client hot-module replacement is needed. Run the complete local acceptance suite with `vp run verify`.

## Remote database provisioning

Create the two remote D1 databases once, using the `wnam` location hint, while authenticated as the Owner:

```sh
wrangler d1 create startree-preview --location wnam
wrangler d1 create startree-production --location wnam
```

If Wrangler does not resolve a binding by `database_name`, copy the returned database UUID into the matching environment's `database_id` in `wrangler.jsonc`. Never reuse either database in another environment.

## Deployment

The only deployment entry points are explicit:

```sh
vp run deploy:preview
vp run deploy:production
```

Select a non-default Wrangler authentication profile without changing the active profile:

```sh
WRANGLER_PROFILE=txchendev vp run deploy:preview
```

Both repeat the complete local verification, list that environment's pending remote D1 migrations, require every migration to carry the reviewed `startree: expand-contract-compatible` declaration, apply migrations, and strictly deploy that environment. Production additionally requires a clean working tree and a current commit already present on `origin/master`. The command prints the target and active Worker version ID. There is no default deployment command.

Expand/contract is mandatory: first add nullable or independently usable schema, deploy code that tolerates both shapes, backfill separately when required, and remove the old shape only after the immediately previous Worker no longer depends on it. Never combine a destructive contract step with the release that first introduces its replacement. This keeps the previous Worker usable when migration succeeds but upload fails.

`deploy:production` targets `https://startree.txchen.win` and must never be run merely to test configuration. Use `wrangler deploy --dry-run --env production --profile txchendev` for a non-deploying configuration check. A failed upload leaves the prior deployment active; record the command output, inspect deployment status, and do not rerun migrations independently.

## Representative preview measurement

Preview holds synthetic data only. Preparing a case replaces all preview Bookmark data and never targets production:

```sh
STARTREE_CONFIRM_PREVIEW_RESET=synthetic-preview-only WRANGLER_PROFILE=txchendev \
  vp run performance:prepare:preview -- hierarchy
STARTREE_CONFIRM_PREVIEW_RESET=synthetic-preview-only WRANGLER_PROFILE=txchendev \
  vp run performance:prepare:preview -- concentration
STARTREE_CONFIRM_PREVIEW_RESET=synthetic-preview-only WRANGLER_PROFILE=txchendev \
  vp run performance:prepare:preview -- maximum-fields
```

The hierarchy and concentration cases each contain 10,000 Bookmarks and 1,000 Folders; hierarchy reaches ten levels, concentration places every Bookmark in one Folder, and maximum fields remain a separate nonrepresentative stress case. `vp run verify:performance-data` proves all three fixtures against local D1 in CI.

Capture a temporary authenticated browser state outside the repository, then measure hierarchy and concentration separately. Delete the state file after use:

```sh
STARTREE_PREVIEW_URL=https://startree-preview.<account-subdomain>.workers.dev \
STARTREE_ACCESS_STORAGE_STATE=/tmp/startree-access.storage-state.json \
  vp run access:capture:preview

STARTREE_PREVIEW_URL=https://startree-preview.<account-subdomain>.workers.dev \
STARTREE_ACCESS_STORAGE_STATE=/tmp/startree-access.storage-state.json \
STARTREE_PERFORMANCE_CASE=hierarchy vp run measure:preview
```

Run the measurement again with `STARTREE_PERFORMANCE_CASE=concentration` after preparing that case. Each command performs five cold and five warm runs, reports samples and the 75th percentile, and fails the settled warm, cold, LCP, INP, CLS, local-interaction, or cold hard-ceiling target. This Playwright/PerformanceObserver evidence is repository-supported fallback evidence; use a Chrome DevTools trace as the primary artifact whenever that MCP is available.

## Owner visual acceptance

On the Access-protected fixed preview, the Owner must confirm this checklist on a representative desktop browser and mobile browser before V1 closure:

- calm Quiet library hierarchy, spacing, typography, and Bookmark cards;
- responsive desktop sidebar and mobile Folder drawer;
- focused Folder and Bookmark editors, dirty dismissal, keyboard focus, and visible pending/failure states;
- desktop drag-and-drop ordering and moving feel;
- Trash confirmation, Undo, restore, permanent deletion, and empty states;
- root, empty Folder, missing Folder, empty search, offline, and unavailable states;
- mobile read-only browsing/search with no management controls.

Record browser names and versions plus an explicit pass or the remaining defects. Automated checks cannot grant this acceptance.

## Inspection and rollback

Use Workers Logs for redacted structured runtime errors:

```sh
wrangler tail --env preview
wrangler tail --env production
```

Select `--profile txchendev` when the profile is not active. Logs may contain only safe event names, mutation type/outcome/conflict classification, request and operation IDs, sanitized exception types/cause frames, and Git commit SHA. Stop investigation if output contains an Access header, cookie, request body, SQL, Bookmark URL/title, Folder name, Tag, or Note; treat that as a privacy incident.

Inspect D1 without including Owner content in shared diagnostics:

```sh
wrangler d1 migrations list DB --remote --env preview
wrangler d1 execute DB --remote --env preview --command "SELECT revision FROM bookmark_domain_state"
```

For a code regression, list versions and roll back the affected Worker by version ID. A Worker rollback does not reverse D1 schema or data:

```sh
wrangler versions list --env production
wrangler rollback --env production <VERSION_ID>
```

There are three incident paths:

1. A failed upload leaves the previous Worker active.
2. A newly deployed code regression is rolled back by Worker version ID.
3. A suspected D1 migration or data problem stops further deployments and writes pending manual inspection. Never attempt an automatic reverse migration.

For authentication expiry, allow the failed online request to enter Cloudflare Access login normally. Confirm retained cached Bookmarks remain visible while refresh reports failure, then authenticate and retry. Never clear the usable snapshot as an expiry workaround.
