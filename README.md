<p align="center">
  <img src="public/brand-mark.svg" width="64" height="64" alt="Startree logo">
</p>

# Startree

Startree is a private, self-hosted bookmark workspace designed to work as a browser start page or new-tab destination. It keeps a large bookmark library compact, searchable, available offline, and pleasant to navigate without turning the page into a dashboard of unrelated widgets.

## Features

- Hierarchical Folders with a resizable desktop tree and a mobile drawer
- Compact Bookmark cards with optional Tags and Notes
- Fast local search across Folder names, titles, URLs, Tags, and Notes
- Keyboard-first search with `/`, `Cmd/Ctrl+K`, arrow keys, `Enter`, and `Cmd/Ctrl+Enter`
- Folder and Bookmark creation, editing, moving, and drag-and-drop ordering
- Trash, undo, restore, permanent deletion, and conflict-aware writes
- Remembered Folder navigation for start-page and new-tab use
- Retained IndexedDB snapshots and offline browsing through a service worker
- Responsive and accessibility-checked UI

## Stack

| Area       | Technology                                    |
| ---------- | --------------------------------------------- |
| Client     | Vue 3, Vue Router, TypeScript                 |
| Search     | MiniSearch in a Web Worker                    |
| API        | Hono on Cloudflare Workers                    |
| Database   | Cloudflare D1                                 |
| Offline    | IndexedDB, Workbox, service worker            |
| Validation | Valibot                                       |
| Tooling    | Vite+, Wrangler, Vitest, Playwright, axe-core |

The built Vue application and Hono API are served by one Worker. D1 is authoritative; the browser retains a complete compatible snapshot in IndexedDB for fast startup and offline reading. Bookmark search is built locally from that active snapshot.

## Requirements

- Node.js 22.12 or newer
- npm 11.5.2 or a compatible npm 11 release
- Wrangler 4.x, installed through this repository's development dependencies
- Chromium for the complete browser acceptance suite

## Local development

Install dependencies and initialize the local D1 database:

```sh
npm install
npm run db:migrate:local
```

Build the client and start the combined local Worker:

```sh
npm run dev:worker
```

Wrangler prints the local URL, normally `http://localhost:8787`. For client-only hot-module replacement, use `npm run dev`.

## Verification

Install the Playwright Chromium build once on a development machine:

```sh
npx playwright install chromium
```

Run the same complete verification used by releases:

```sh
npm run verify
```

The verification pipeline covers formatting, linting, TypeScript, unit tests, production builds, migration safety, environment isolation, performance fixtures, accessibility, browser interaction, offline behavior, and a complete local D1-backed Worker.

Useful narrower commands:

| Command                | Purpose                                       |
| ---------------------- | --------------------------------------------- |
| `npm run check`        | Formatting, linting, and type checking        |
| `npm test`             | Unit and script tests                         |
| `npm run build`        | Production client and service-worker build    |
| `npm run verify:local` | Full local Worker and browser acceptance test |
| `npm run types`        | Regenerate Cloudflare binding types           |

CI uses the Chrome installation provided by the GitHub-hosted runner, avoiding a repeated Playwright browser and system-package download.

## Environments and deployment

Startree has isolated `local`, `preview`, and `production` Workers and D1 databases. Remote environments must be protected by whole-application Cloudflare Access policies before deployment.

The only supported deployment entry points are explicit:

```sh
WRANGLER_PROFILE=txchendev npm run deploy:preview
WRANGLER_PROFILE=txchendev npm run deploy:production
```

Both commands rerun complete verification, validate expand/contract migration safety, apply pending migrations, and deploy the selected environment. Production additionally requires a clean commit already present on `origin/master`.

Read [docs/operations.md](docs/operations.md) before provisioning, deploying, measuring performance, inspecting remote data, or rolling back a Worker.

## Data and privacy model

Startree is a single-Owner application. Cloudflare Access is the remote authentication boundary; the application does not implement public sign-up or multi-user tenancy.

- D1 is the authoritative Bookmark store.
- IndexedDB retains compatible snapshots, navigation, and unresolved operations in the browser.
- Structured Bookmark data is not stored in Cache Storage, `localStorage`, or `sessionStorage`.
- API responses are private and non-cacheable.
- Logs and shared diagnostics must never contain Bookmark titles, URLs, Folder names, Tags, Notes, cookies, Access headers, or request bodies.

## Repository guide

```text
src/client/       Vue UI, local state, search, and offline behavior
src/server/       Hono Worker, security boundaries, and Bookmark service
src/shared/       Validated contracts shared by client and server
migrations/       D1 schema migrations
scripts/          Verification, deployment, and performance tooling
tests/fixtures/   Synthetic acceptance data
docs/             Operations, research, and agent guidance
```

Domain terminology lives in [CONTEXT.md](CONTEXT.md). GitHub Issues are the project tracker; repository-specific issue and triage conventions are documented under [docs/agents](docs/agents).
