# Router removal and dependency review

This change removes Vue Router from the production implementation while keeping Vue locked at the existing 3.5.41 version. It does not adopt Vapor or any of the experimental branch's framework upgrades.

## Navigation behavior

Startree currently has one Page. Folder selection is already local state, so a full router no longer drives normal browsing. The application now resolves its small set of paths directly and uses native browser history for home navigation:

- `/` and `/bookmarks` restore the retained Folder without redirecting normal startup.
- Legacy `/bookmarks/<folder-id>` links open that Folder and replace the URL with `/`.
- Home links preserve modified clicks and new-tab behavior.
- Back and forward update the displayed Page without reloading the document.
- Unknown paths keep the application shell and its home link, matching the previous unmatched-route behavior.

Vue Router and its now-unused `@vue/devtools-api` dependency are removed from the lockfile. No other locked package version changes. If the product grows into several Pages, navigation requirements should be reassessed rather than expanding this resolver into a general-purpose router.

## Measurements

Baseline: `bed022c`. Both production builds use Vue 3.5.41 and identical dependencies except for removing Router. Bundle sizes below describe complete emitted files compressed with Node zlib defaults, in decimal KB; these differ slightly from Vite's console estimates.

| Asset             | Before raw | After raw | Before gzip | After gzip |
| ----------------- | ---------: | --------: | ----------: | ---------: |
| Application entry |     166.27 |    141.78 |       55.36 |      46.53 |
| Search Worker     |      29.03 |     29.03 |        9.22 |       9.22 |
| Service worker    |      25.69 |     25.69 |        8.28 |       8.27 |

The application entry shrinks by **24.49 KB raw (14.7%)** and **8.82 KB gzip (15.9%)**. CSS and search code are unchanged. The service worker's tiny compressed-size difference is due to its updated precache manifest.

Local browser measurements use a synthetic hierarchy of 10,000 Bookmarks and 1,000 Folders. Timing medians cover five fresh contexts; heap medians cover three contexts after garbage collection. Runs are sequential, service workers and external favicons are blocked, and the same Chromium build measures both variants.

| Metric                       |  Before |   After |
| ---------------------------- | ------: | ------: |
| Cold Folder tiles ready      |  444 ms |  441 ms |
| Retained Folder tiles ready  |  248 ms |  243 ms |
| Open a 10-Bookmark Folder    |   64 ms |   52 ms |
| Root page retained JS heap   | 6.31 MB | 6.16 MB |
| Folder page retained JS heap | 6.78 MB | 6.64 MB |

These small timing samples do not establish a proportional speedup from reducing download size. The reliable result is a smaller bundle and a simpler dependency graph. Heap measurements exclude native DOM, graphics, service workers, and process memory. Folder timing uses two animation frames after the cards appear as a paint-opportunity proxy, not a Web Vital.

[Raw measurements](./router-removal-measurements.json) include the exact browser version and all samples.

## Remaining dependencies

There is no general-purpose UI component library, icon package, or date utility library to remove. Application components use native HTML and Vue.

| Dependency                                                     | Current purpose and observed bundle placement                                           | Recommendation                                                                                                                        |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Vue                                                            | Rendering and reactive state in the application entry                                   | Retain; removing it would require an application rewrite.                                                                             |
| MiniSearch                                                     | Local search indexing and ranking, isolated to the search Worker                        | Retain; the main UI bundle does not include it.                                                                                       |
| Valibot                                                        | Validates server requests, remote snapshots, retained local data, and command contracts | Retain real validation; avoid unintentionally including schema construction in Workers that only import constants.                    |
| Workbox                                                        | Precache revisions, offline navigation, and cache cleanup in the service worker         | A hand-written replacement is possible, but would need equivalent upgrade, offline, and logout coverage. It is not the next priority. |
| Hono                                                           | Server-side API routing                                                                 | Does not enter client bundles; removing it cannot reduce client download or browser memory.                                           |
| Vite+, TypeScript, Vue tooling, Playwright, axe-core, Wrangler | Build, validation, test, and deployment tooling                                         | Not browser runtime libraries; deleting them would not directly shrink the client.                                                    |

### Applied follow-up: separate constants from validation

The search adapter only needs `SYSTEM_ROOT_FOLDER_ID` at runtime from the shared contracts file. The service worker's retained-snapshot compatibility code only needs `BOOKMARK_SNAPSHOT_WIRE_FORMAT_VERSION`. Previously, importing those constants from the same module as top-level schema construction retained Valibot code in both Workers.

The follow-up now moves the three shared identifiers/version constants into `src/shared/bookmarks/constants.ts`, re-exports them from the existing contracts module, and changes the two Worker-reachable imports to the constants module. Validation callers, schemas, and backend behavior are unchanged. Production source maps confirm that neither browser Worker includes Valibot or the validation contracts module, while the application entry retains Valibot.

| Worker         | Before gzip | After gzip |  Saving |
| -------------- | ----------: | ---------: | ------: |
| Search Worker  |     9.22 KB |    7.09 KB | 2.13 KB |
| Service worker |     8.27 KB |    6.10 KB | 2.18 KB |

The combined saving is approximately **4.31 KB gzip**, with almost no change to the application entry. The change removes unnecessary Worker imports while preserving validation. The preceding Router measurements and the temporary probe remain in the raw results as historical baselines; `appliedWorkerCleanup` records the actual follow-up build.

## Validation and reproduction

Formatting, lint, type checks, 128 unit tests, 10 script tests, the production build, and both Chrome browser acceptance scenarios passed. Added coverage exercises the home link, a Control-click opening a separate tab, back/forward history, unknown paths, and pathname decoding. Existing coverage retains legacy links, immediate refresh retention, offline use, editing, search, accessibility, and mobile behavior.

```sh
npm run build
node scripts/measure-bundle.mjs
node scripts/measure-rendering.mjs hierarchy
node scripts/measure-memory.mjs hierarchy
```

Use `STARTREE_PERFORMANCE_DIST=/absolute/path/to/build` to run identical browser measurement code against a saved baseline build. Synthetic data stays local; production Bookmark data is not read.
