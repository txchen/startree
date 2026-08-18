# Operations

Startree has local, preview, and production environments. Their Worker names and D1 database names are deliberately distinct. Deployments run only from the Owner's authenticated local machine; CI never receives Cloudflare credentials, contacts remote D1, or deploys.

## Access prerequisite

Before the first remote release, configure Cloudflare Access to protect the entire `startree-preview.<account-subdomain>.workers.dev` application and the entire `startree.txchen.win` application. Policies must include every path, including `/api/*`, and allow only the Owner. Production disables both `workers.dev` and version preview URLs in `wrangler.jsonc`; preview disables per-version preview URLs so its fixed, Access-protected hostname is the only preview surface.

Verify both Access applications and their policies in Zero Trust before every first deployment or hostname change. Do not deploy an environment when its whole-application Access policy is absent.

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

Both repeat local checks and the production build, list and apply only that environment's pending remote D1 migrations, and deploy that environment. Production additionally requires a clean working tree and a current commit already present on `origin/master`. Migrations must remain compatible with the previously deployed Worker. There is no default deployment command.

`deploy:production` targets `https://startree.txchen.win` and must never be run merely to test configuration. Use `wrangler deploy --dry-run --env production` for a non-deploying configuration check.

## Inspection and rollback

Use Workers Logs for redacted structured runtime errors:

```sh
wrangler tail --env preview
wrangler tail --env production
```

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
