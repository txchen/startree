<p align="center">
  <img src="public/brand-mark.svg" width="72" height="72" alt="Startree logo">
</p>

<h1 align="center">Startree</h1>

<p align="center"><strong>Your bookmarks, independent of your browser.</strong></p>
<p align="center">A self-hosted start page with searchable bookmarks and encrypted private notes.</p>
<p align="center">
  <a href="#features">Features</a> ·
  <a href="#deploy">Deploy</a> ·
  <a href="#develop">Develop</a> ·
  <a href="#documentation">Documentation</a>
</p>

Switch browsers without moving your bookmarks or setting up another sync service. Startree keeps one library at your own URL, ready to open in whichever browser you use. Set it as your start page, or use it as a new-tab destination where your browser supports one.

Folders, tags, pinned bookmarks, and full-library search give you more ways to organize and find things than a browser bookmark menu. A separate encrypted notebook keeps private writing in the same workspace.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/bookmarks-dark.png">
  <img src="docs/images/bookmarks.png" alt="Startree bookmark library with folders, pinned bookmarks, and tagged cards" width="1440">
</picture>

## Features

|                 | What you can do                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Organize        | Nest folders, add tags and annotations, and drag bookmarks into order on desktop.                                                              |
| Find            | Search titles, URLs, folders, tags, and annotations. Narrow results by tag or domain. Open search with `/` or `Ctrl/Cmd+K`.                    |
| Keep close      | Pin bookmarks from any folder. Return to your last folder or revisit recently opened bookmarks.                                                |
| Manage          | Create and edit bookmarks in place, review exact-URL duplicates, and recover deleted items from Trash.                                         |
| Read offline    | Browse and search the library retained in your browser after an online visit.                                                                  |
| Write privately | Encrypt note titles, text, and version history in the browser. Save offline drafts, export encrypted backups, and recover with a separate key. |
| Make it yours   | Choose a theme and browse on desktop or mobile. Mobile bookmark browsing is read-only.                                                         |

Startree is built for one owner, not a shared team account. You host it on Cloudflare Workers and D1, with Cloudflare Access protecting the whole application. Bookmarks are stored unencrypted in D1; browser-side encryption applies to the separate Notes page, not bookmark annotations.

## Deploy

Use a POSIX shell on Linux or macOS. On Windows, use WSL with Linux Node.js and npm installed inside WSL, not Windows executables or Git Bash with Windows Node. Native PowerShell and Command Prompt deployment is unsupported and untested. Verification evidence is from Linux.

Recommended: Node.js 22 LTS, version 22.18 or later within the 22.x line, and npm 11. An existing Node.js 24 LTS installation at 24.11 or later also meets the dependency range; no downgrade is needed. You also need a Cloudflare account with Workers, D1, Access, and a domain for production.

1. Clone this repository, then install and verify locally before authentication or provisioning. Fork only if you want to modify the source and maintain your own version. Deployment does not require a Playwright browser installation.

   ```sh
   git clone https://github.com/txchen/startree.git
   cd startree
   node --version
   npm --version
   npm ci --include=dev --include=optional
   npm run verify:deploy
   ```

   Stop if installation or deployment verification fails. Follow [installation troubleshooting](docs/operations.md#installation-troubleshooting), not dependency upgrades. Verification uses synthetic configuration and needs no Cloudflare credentials or private deployment file.

2. Authenticate the bundled Cloudflare CLI, create separate preview and production D1 databases, and configure your database IDs and production hostname. Copy `deployment.example.json` to the ignored `deployment.local.json`, run `chmod 600 deployment.local.json`, and edit its IDs and domain. Follow [first-time deployment](docs/operations.md#first-time-deployment). No source or test changes are needed.

3. Protect **every path**, including `/api/*`, with Cloudflare Access before deploying. Startree has no built-in login and must not be exposed without Access.

4. Deploy preview first, then production.

   ```sh
   npm run deploy:preview
   npm run deploy:production
   ```

   If you use a named CLI authentication profile, prefix either command with `CF_PROFILE=your-profile`.

Both commands run browser-free checks and apply database migrations before deployment. Production also requires a clean working tree and a current commit already present on `origin/master`. A direct clone satisfies the Git requirements without write access to this repository. See the [operations guide](docs/operations.md) for Access checks, release safety, and rollback.

## Develop

No Cloudflare account or private deployment file is needed for local development, tests, type generation, or CI verification.

```sh
npm ci
npm run db:migrate:local
npm run dev:worker
```

Open the URL printed by the CLI, normally `http://localhost:8787`. This runs the built client and API together against local D1. Use `npm run dev` for client-only hot reload.

| Command          | Purpose                                                                               |
| ---------------- | ------------------------------------------------------------------------------------- |
| `npm run check`  | Check formatting, lint rules, and TypeScript.                                         |
| `npm test`       | Run unit and script tests.                                                            |
| `npm run build`  | Build the client and service worker.                                                  |
| `npm run verify` | Run the full development checks, including local Worker and browser acceptance tests. |

Before running browser checks, install Chromium with `npx playwright install chromium`. For deployment checks without a browser, run `npm run verify:deploy`.

The client uses Vue 3 and TypeScript. Hono serves the API from the same Worker, D1 stores authoritative data, and IndexedDB retains local copies. MiniSearch runs bookmark search in a Web Worker.

Start with `src/client/` for the UI, `src/server/` for the API, and `src/shared/` for validated contracts. Database migrations live in `migrations/`; release and verification tools live in `scripts/`.

## Documentation

- [Operations](docs/operations.md): provisioning, Access policies, deployment, and rollback.
- [Private Notes](docs/private-notes.md): saving, offline drafts, recovery, and backups.
- [Encryption design](docs/encrypted-notes-design.md): algorithms, trust boundaries, synchronization, and limits.
- [Data and privacy](docs/data-and-privacy.md): server storage, browser retention, and diagnostics.
- [Domain terminology](CONTEXT.md): the concepts used throughout the codebase.

Screenshots use synthetic example data.
