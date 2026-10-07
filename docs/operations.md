# Operations

Startree has local, preview, and production environments. Preview uses the `startree-preview` Worker and production uses the `startree` Worker; their D1 database names remain deliberately distinct. Deployments run only from the Owner's authenticated local machine; CI never receives Cloudflare credentials, contacts remote D1, or deploys.

## First-time deployment

Use a POSIX shell on Linux or macOS. On Windows, run inside WSL with Linux Node.js and npm installed there. Do not use Windows executables from WSL or Git Bash with Windows Node. Native PowerShell and Command Prompt deployment is unsupported and untested. The verification evidence is Linux-only.

Clone the repository directly. Fork only if you want to modify the source and maintain your own version. Recommended: Node.js 22 LTS, version 22.18 or later within the 22.x line, and npm 11. An existing Node.js 24 LTS installation at 24.11 or later also meets the dependency range; no downgrade is needed. See the [deployment review](agent-deployment-review.md) for tested versions and verification limits.

Before authentication or provisioning, run these commands from the repository root:

```sh
node --version
npm --version
node -p 'process.platform'
npm ci --include=dev --include=optional
npm run verify:deploy
```

In WSL, `process.platform` must print `linux`. Stop if installation or verification fails and follow [installation troubleshooting](#installation-troubleshooting). Verification uses synthetic configuration without credentials or `deployment.local.json`. It does not validate your Cloudflare account, database IDs, or Access policies. Chromium is not required.

Continue only after installation and deployment verification succeed.

1. Authenticate with `npx cf auth login`. For a named profile, use `npx cf auth create your-profile` and add `--profile your-profile` to direct CLI commands.

2. Create separate databases in your own account.

   ```sh
   npx cf d1 create --name startree-preview
   npx cf d1 create --name startree-production
   ```

3. Create the private deployment file at the repository root.

   ```sh
   cp deployment.example.json deployment.local.json
   chmod 600 deployment.local.json
   ```

4. Edit `deployment.local.json`. Set `preview.databaseId` and `production.databaseId` to the returned UUIDs and `production.domain` to a hostname in your Cloudflare zone, without a scheme or path. For an existing installation, reuse its database IDs. The example is deliberately invalid for deployment. Do not edit source files or test assertions.

5. Configure Access as described below before uploading the application. Keep production `workersDev: false` and `previewUrls: false` in every remote environment.

6. Run `npm run deploy:preview`. Verify that unauthenticated requests cannot reach the application, then test authenticated bookmark creation, reload, and search.

7. Run `npm run deploy:production`. Production requires a clean working tree and a current commit already present on `origin/master`. A direct clone satisfies these Git requirements without pushing anything. If you modify the source, push your changes to `master` in your own fork and point `origin` to that fork before deploying production. Never commit `deployment.local.json`; back it up privately.

Keep credentials in CLI authentication profiles, never in repository files. Database IDs are resource identifiers rather than access credentials, but can still identify your installation.

## Installation troubleshooting

For an AI agent, an install failure is evidence about this attempt, not proof that a package or version is unavailable.

- Stop before login, provisioning, or deployment. Record the failed command, package and version, hostname, error code, OS, and Node and npm versions. Redact tokens, authenticated URLs, and private values before sharing logs. Do not dump environment variables or complete npm configuration.
- For DNS errors, timeouts, proxy errors, or certificate failures, check access to the actual failing endpoint using the approved registry, proxy, and CA configuration. A failed request alone does not establish that the pinned version is missing. Claim unavailability only with a successful authoritative registry response for that exact version. Otherwise report the observed error and leave availability unresolved.
- For engine errors, check the required Node.js and npm versions above. For missing native packages, check OS and architecture and confirm that development and optional dependencies were installed. Deployment needs build tools and the local Worker runtime even though it is browser-free.
- Preserve `package.json`, `package-lock.json`, and the pinned `cf` and Wrangler versions. Do not regenerate the lockfile, run upgrade or audit-fix commands, substitute a global CLI, use arbitrary mirrors, omit development or optional dependencies, or disable TLS verification.
- After correcting the evidenced environment or network problem, retry `npm ci --include=dev --include=optional`, then `npm run verify:deploy`. If blocked, report the redacted evidence and stop. Installing Chromium does not repair deployment checks.

## Access prerequisite

Before the first remote release, configure Cloudflare Access to protect the entire `startree-preview.<account-subdomain>.workers.dev` application and the entire `startree.example.com` application. Policies must include every path, including `/api/*`, and allow only the Owner. Production disables both `workers.dev` and version preview URLs in `cloudflare.config.ts`; preview disables per-version preview URLs so its fixed, Access-protected hostname is the only preview surface.

Verify both Access applications and their policies in Zero Trust before every first deployment or hostname change. Do not deploy an environment when its whole-application Access policy is absent.

From a browser without an Access session, verify `/`, `/bookmarks`, `/api/v1/platform`, `/api/bookmarks/snapshot`, `/api/bookmarks/trash`, and `/api/bookmarks/commands`. Every request must enter the Access login flow and none may expose an application response. Repeat against every configured custom domain and fixed `workers.dev` hostname. In the Workers dashboard, confirm that preview version URLs are disabled and that production has both version URLs and `workers.dev` disabled. A redirect or denial from a nonexistent production surface is expected before the first production release; application content is not.

API responses must not include `Access-Control-Allow-Origin` or `Access-Control-Allow-Credentials`. A command sent with a foreign or absent `Origin` must return the structured `invalid_origin` response after Access authentication. Never copy Access cookies, assertions, identity headers, or request bodies into tickets or logs.

## Local development

Install dependencies, apply migrations, and start the combined Worker:

```sh
npm ci
npm run db:migrate:local
npm run dev:worker
```

`cf dev --mode local` serves the built Vue client and Hono API together. Use `npm run dev` when only client hot-module replacement is needed. For development acceptance tests, install Chromium with `npx playwright install chromium`, then run `npm run verify`. Local development, tests, type generation, and CI do not need `deployment.local.json`. Verification injects deterministic synthetic configuration and never reads private deployment values.

## Remote database provisioning

After first-time provisioning, `deployment.local.json` pins your remote database UUIDs and production domain. Later migrations must reuse them rather than provision replacements. Preview and production names and UUIDs must remain distinct. `cf d1 migrations` takes a database UUID and `--dir ./migrations`, and preserves the existing `d1_migrations` history.

## Deployment

The only deployment entry points are explicit:

```sh
npm run deploy:preview
npm run deploy:production
```

Select a non-default Cloudflare CLI authentication profile without changing the active profile:

```sh
CF_PROFILE=your-profile npm run deploy:preview
```

Both run `npm run verify:deploy` for formatting, linting, type checking, unit and script tests, the production build, migration validation, environment isolation, and Notes loading checks. These checks do not launch a browser. Browser acceptance remains in development verification and CI.

The deployment commands then run a non-uploading `cf deploy --dry-run`, list that environment's pending remote D1 migrations, require every migration to carry the reviewed `startree: expand-contract-compatible` declaration, apply migrations, and deploy that environment using `cf deploy`. Production additionally requires a clean working tree and a current commit already present on `origin/master`. The command prints the target and active Worker version ID. There is no default deployment command. Missing, malformed, placeholder, or non-isolated deployment configuration blocks deployment and D1 helpers before they start remote commands, including production's Git fetch. Run commands from the repository root.

Expand/contract is mandatory: first add nullable or independently usable schema, deploy code that tolerates both shapes, backfill separately when required, and remove the old shape only after the immediately previous Worker no longer depends on it. Never combine a destructive contract step with the release that first introduces its replacement. This keeps the previous Worker usable when migration succeeds but upload fails.

Compatible service-worker releases activate without waiting for all existing tabs to close. Open documents retain their current UI and drafts; subsequent navigation uses the updated shell. Bookmark snapshots missing pin metadata are reloaded from the server even when their revision matches, because an older tab can strip fields from shared IndexedDB data. The full development verification includes an upgrade from an already installed cache-first shell with an older tab kept open.

`deploy:production` targets your configured production hostname and must never be run merely to test configuration. Use `npx cf deploy --dry-run --mode production --profile your-profile` for a non-deploying configuration check. A failed upload leaves the prior deployment active; record the command output, inspect deployment status, and do not rerun migrations independently.

## Representative preview measurement

Preview holds synthetic data only. Preparing a case replaces all preview Bookmark data and never targets production:

```sh
STARTREE_CONFIRM_PREVIEW_RESET=synthetic-preview-only CF_PROFILE=your-profile \
  npm run performance:prepare:preview -- hierarchy
STARTREE_CONFIRM_PREVIEW_RESET=synthetic-preview-only CF_PROFILE=your-profile \
  npm run performance:prepare:preview -- concentration
STARTREE_CONFIRM_PREVIEW_RESET=synthetic-preview-only CF_PROFILE=your-profile \
  npm run performance:prepare:preview -- maximum-fields
```

The hierarchy and concentration cases each contain 10,000 Bookmarks and 1,000 Folders; hierarchy reaches ten levels, concentration places every Bookmark in one Folder, and maximum fields remain a separate nonrepresentative stress case. `npm run verify:performance-data` proves all three fixtures against local D1 in CI.

Capture a temporary authenticated browser state outside the repository, then measure hierarchy and concentration separately. Delete the state file after use:

```sh
STARTREE_PREVIEW_URL=https://startree-preview.<account-subdomain>.workers.dev \
STARTREE_ACCESS_STORAGE_STATE=/tmp/startree-access.storage-state.json \
  npm run access:capture:preview

STARTREE_PREVIEW_URL=https://startree-preview.<account-subdomain>.workers.dev \
STARTREE_ACCESS_STORAGE_STATE=/tmp/startree-access.storage-state.json \
STARTREE_PERFORMANCE_CASE=hierarchy npm run measure:preview
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

Use the Cloudflare dashboard's Workers Logs view for redacted structured runtime errors.

Select `--profile your-profile` when the profile is not active. Logs may contain only safe event names, mutation type/outcome/conflict classification, request and operation IDs, sanitized exception types/cause frames, and Git commit SHA. Stop investigation if output contains an Access header, cookie, request body, SQL, Bookmark URL/title, Folder name, Tag, or Note; treat that as a privacy incident.

Set `PREVIEW_DATABASE_ID` to your preview UUID before inspecting D1. Do not include Owner content in shared diagnostics:

```sh
npx cf d1 migrations list "$PREVIEW_DATABASE_ID" --mode preview --dir ./migrations
npx cf d1 query "$PREVIEW_DATABASE_ID" --mode preview --sql "SELECT revision FROM bookmark_domain_state"
```

For a code regression, list versions and roll back the affected Worker by version ID. A Worker rollback does not reverse D1 schema or data:

```sh
npx cf workers versions list --mode production --worker startree
npx cf workers deployments create --mode production --worker startree \
  --strategy percentage --versions '[{"version_id":"<VERSION_ID>","percentage":100}]'
```

There are three incident paths:

1. A failed upload leaves the previous Worker active.
2. A newly deployed code regression is rolled back by Worker version ID.
3. A suspected D1 migration or data problem stops further deployments and writes pending manual inspection. Never attempt an automatic reverse migration.

For authentication expiry, allow the failed online request to enter Cloudflare Access login normally. Confirm retained cached Bookmarks remain visible while refresh reports failure, then authenticate and retry. Never clear the usable snapshot as an expiry workaround.

## cf beta migration details

The project pins `cf@1.0.0-beta.12` and its supported Wrangler build/dev adapter. All deployment, database, and type-generation entry points use `cf`. Worker settings are defined in `cloudflare.config.ts`, with private remote identities loaded from `deployment.local.json`; the old JSONC configuration has been removed. `CF_PROFILE` selects a local authentication profile. Missing or unknown modes fail closed. Release scripts pass the Git SHA through `STARTREE_RELEASE_REVISION` for `APP_VERSION` and tag the deployed version.

The beta can leave a Miniflare file watcher alive after a local D1 command completes. `scripts/cf-local.mjs` awaits the official CLI entry point, flushes output, and exits with its status; it is restricted to finite local D1 commands and is not used for deployment or dev servers. This beta implements local D1 reads through `cf d1 raw`; `scripts/cloudflare.mjs` converts its column/row response into objects. Local development uses the adapter's `.wrangler/state` persistence directory, so `db:migrate:local` explicitly targets it. Browser acceptance creates a temporary project with source/build symlinks and its own `.wrangler/state`, because the beta's dev adapter does not forward `--persist-to`. Ports come from `STARTREE_DEV_PORT` in the adapter config. No test contacts remote D1. Synthetic performance fixtures use bounded batches through the API; a failed import may leave preview partially populated and should be rerun, never used against production.

Run `npm run types` to regenerate `worker-configuration.d.ts` from `cf workers types`. `.cloudflare/` is generated output and is not committed. Native configuration and inferred Worker bindings are covered by server type checking. Use the Node.js guidance in the first-time deployment instructions for TypeScript configuration loading.
