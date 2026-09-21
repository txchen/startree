<p align="center">
  <img src="public/brand-mark.svg" width="64" height="64" alt="Startree logo">
</p>

# Startree

Startree is a private, self-hosted bookmark workspace designed to work as a browser start page or new-tab destination. It keeps a large bookmark library compact, searchable, available offline, and pleasant to navigate without turning the page into a dashboard of unrelated widgets.

## Features

- Hierarchical Folders with a resizable desktop tree and a mobile drawer
- Cross-Folder pinned Bookmarks with manual ordering, cloud synchronization, and offline browsing
- Compact Bookmark cards with optional Tags and Notes
- Fast local search across Folder names, titles, URLs, Tags, and Notes, with Tag and domain filters
- Keyboard-first search with `/`, `Cmd/Ctrl+K`, arrow keys, `Enter`, and `Cmd/Ctrl+Enter`
- In-page Bookmark capture with current-Folder placement, Tag suggestions, and exact-URL awareness
- Folder and Bookmark creation, editing, moving, and drag-and-drop ordering
- Advisory exact-URL duplicate review with recoverable deletion through Trash
- Trash, undo, restore, permanent deletion, and conflict-aware writes
- Remembered Folder navigation for start-page and new-tab use
- Stable URLs while browsing: Folder selection stays local and the root URL restores the last Folder
- Retained IndexedDB snapshots and offline browsing through a service worker
- A lazy-loaded, browser-encrypted Notes Page with local search, encrypted offline drafts, recovery keys, and explicit conflict handling
- Responsive and accessibility-checked UI

## Stack

| Area       | Technology                                    |
| ---------- | --------------------------------------------- |
| Client     | Vue 3, TypeScript                             |
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
- IndexedDB retains compatible snapshots, navigation, unresolved operations, and the 10 most recently opened Bookmark IDs in the browser. Recent activity stays in this browser, works offline, and can be cleared from the Recently opened list.
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

## Private Notes

Open **Notes**, choose a separate password, and save and verify the recovery key before writing. Titles and bodies are encrypted in the browser before they reach Cloudflare. Refresh, leaving Notes, or 15 minutes of inactivity locks the notebook. Unsynced encrypted drafts can be resumed from the unlock screen; resolve competing edits with **Keep both versions**. Settings includes password/recovery rotation and encrypted backup export. Import accepts encrypted backups on the unlock screen.

The initial notebook limit is 500 plain-text notes and 512 KiB of serialized content. Losing both the password and recovery key loses access to the notes; an application login reset cannot decrypt them. See [Encrypted Notes design](docs/encrypted-notes-design.md) for storage, trust boundaries, and recovery behavior, and [Notes performance review](docs/notes-performance-review.md) for startup measurements.
