# Vue Vapor experiment

This branch evaluates whether migrating Startree to Vue Vapor improves startup, Folder rendering, retained JavaScript memory, and application download size. It is an experiment, not a production release.

## Result and recommendation

Do not merge this experiment as a performance upgrade. Pure Vapor reduces the main JavaScript download, but the measured application does not show a dependable UI speedup and retains significantly more page heap in the concentrated Folder. Keep the production renderer for now. If pursuing another optimization, evaluate the simpler navigation independently and prioritize rendering fewer cards for very large individual Folders.

### Download size

Complete-file sizes in decimal KB, using the same compression settings for every variant:

| Variant                            | Main JS raw | Main JS gzip | Main JS Brotli |
| ---------------------------------- | ----------: | -----------: | -------------: |
| Current Vue 3.5                    |      166.27 |        55.36 |          49.66 |
| Vue 3.6 Virtual DOM with Router    |      173.67 |        57.64 |          51.27 |
| Vapor with Router interoperability |      249.36 |        84.28 |          74.13 |
| Pure Vapor without Router          |      142.27 |        45.72 |          40.87 |
| Vue 3.6 Virtual DOM without Router |      149.17 |        48.86 |          43.40 |

Pure Vapor saves **17.4%** of the current main entry's gzip size. However, against ordinary Vue with the same simplified navigation, Vapor saves only **3.14 KB (6.4%)**. Removing Router accounts for a substantial part of the overall saving. Interoperability instead increases the main entry by **52.2%** relative to production. The search Worker is unchanged; including the search Worker and service worker, gzip JavaScript totals fall from **72.85 KB to 63.23 KB (13.2%)**. CSS is unchanged.

### Retained JavaScript memory

Three-run medians in decimal MB:

| Variant                            | Hierarchy at root: page | 10,000-card Folder: page | Returned to root: page |
| ---------------------------------- | ----------------------: | -----------------------: | ---------------------: |
| Current Vue 3.5                    |                    6.31 |                    65.85 |                  10.16 |
| Vue 3.6 Virtual DOM with Router    |                    6.34 |                    63.11 |                  10.24 |
| Vapor with Router interoperability |                    6.43 |                    86.32 |                  12.18 |
| Pure Vapor without Router          |                    6.06 |                    81.81 |                  11.45 |
| Vue 3.6 Virtual DOM without Router |                    6.17 |                    62.96 |                  10.10 |

The pure version's concentrated Folder uses **24.2% more page heap than production**, and **29.9% more than the same-navigation Virtual DOM control**. Search Worker heap remains approximately 11.8 MB across variants. The concentration case retains approximately 185,332 DOM nodes with the current renderer and 196,471 with pure Vapor. Both release the rendered cards after returning to the root; neither measurement is a long-running leak test.

### UI timing

Each value is a five-run median in milliseconds. A slash separates the first and repeat batches, rather than pooling runs that experienced different machine conditions.

| Variant                            | Hierarchy cold ready | Hierarchy warm ready | Open 10-card Folder | Open 10,000-card Folder |
| ---------------------------------- | -------------------: | -------------------: | ------------------: | ----------------------: |
| Current Vue 3.5                    |            446 / 454 |            250 / 248 |             54 / 56 |             3529 / 3053 |
| Vue 3.6 Virtual DOM with Router    |                  442 |                  248 |                  54 |                    3058 |
| Vapor with Router interoperability |                  472 |                  259 |                  58 |                    4654 |
| Pure Vapor without Router          |            431 / 632 |            236 / 360 |             53 / 80 |             3281 / 3325 |
| Vue 3.6 Virtual DOM without Router |            435 / 431 |            240 / 240 |             56 / 55 |             3083 / 3101 |

The first pure-Vapor startup batch was slightly faster than production, but that did not reproduce in the second batch. The measurements cannot establish a startup win. The initial 10,000-card improvement relative to Vue 3.5 also disappeared against its repeat batch. Against the same-navigation Vue 3.6 control, pure Vapor was slower in both large-Folder batches. These are local synthetic measurements, not network startup tests or universal Vue benchmarks.

[Raw samples, browser version, and exact bundle sizes](./vue-vapor-measurements.json) are retained alongside this report. Browser measurements used Chromium 151.0.7922.34 and Node v24.13.0; the raw metadata is authoritative.

## Implementations

- `baseline`: production commit `bed022c`, Vue 3.5.41, Vue Router 4.6.4, Virtual DOM rendering.
- `vdom36`: the baseline application with Vue pinned to 3.6.0-rc.9, retaining Virtual DOM rendering and Router.
- `vapor`: commit `377605a`, all six application SFCs compiled with Vapor, `createVaporApp`, and `vaporInteropPlugin` for the existing Router components.
- `pure`: commit `f8fe6aa`, all application SFCs use Vapor without Router or the interoperability plugin. A small pathname resolver and browser history handlers preserve the single-page application, `/bookmarks` alias, legacy Folder links, and home navigation.
- `vdom-slim`: a control built from `f8fe6aa` with only the SFC `vapor` attributes removed and `createVaporApp` changed to `createApp`. It uses the same simplified navigation and separates the benefit of removing Router from the benefit of Vapor compilation.

The experimental dependency is pinned exactly. The `vue` override makes the prerelease usable with dependencies whose peer ranges otherwise exclude prereleases. A clean `npm ci --ignore-scripts` was verified.

## Compatibility findings

Changing compilation mode exposed an event-ordering difference in Tag and Domain filter controls: the existing `change` handler read the previous `v-model` value. Reading the selected value from the event target fixed the failure. The existing browser acceptance test detected the issue without weakening its assertions.

The pure version preserves native Bookmark links and modified home-link clicks, handles browser `popstate`, retains local Folder selection, and canonicalizes legacy Folder links. Added coverage checks pathname resolution, home navigation without document reload, back/forward navigation, and recovery from an unknown path. The complete management and browsing acceptance scenarios passed with Chrome, covering editing, search filters, dialogs, keyboard navigation, offline behavior, refresh retention, accessibility, and mobile browsing.

## Measurement method

All measurements use local production builds, the same browser, and synthetic libraries containing 10,000 Bookmarks and 1,000 Folders. No production data or remote database is accessed. The hierarchy case opens a Folder with 10 Bookmarks; the concentration case opens all 10,000 Bookmarks in one Folder.

Timing runs use five fresh browser contexts per case, blocked service workers and external favicons, and real IndexedDB and search Workers. Cold and warm readiness are measured when the Folder tiles appear. Folder rendering is measured from a programmatic navigation click until two animation frames after cards appear; this includes navigation persistence and rendering but is a paint-opportunity proxy, not an INP or LCP measurement. The application renders the same number of cards in every variant. Timing batches run sequentially. A second batch repeats the baseline, pure Vapor, and slim Virtual DOM control in a different order.

Memory measurements use three fresh contexts per case and collect garbage in both page and search Worker before each sample. Values describe retained JavaScript heap, not browser process RAM; native DOM storage, graphics memory, images, and transient allocation peaks are excluded. DOM counts include comment nodes. Returning to the root checks release of the rendered cards, not long-running leak freedom.

Bundle measurements compress the complete emitted files using Node zlib defaults. These numbers can differ slightly from the bundler's console estimates. Source maps are excluded from download totals; sourceMappingURL comments remain included. The application entry, search Worker, and service worker are reported separately in the raw results.

## Reproduction

Build the desired revision in a separate checkout, then run:

```sh
npm ci
npm run build
node scripts/measure-bundle.mjs
node scripts/measure-rendering.mjs hierarchy
node scripts/measure-rendering.mjs concentration
node scripts/measure-memory.mjs hierarchy
node scripts/measure-memory.mjs concentration
```

To compare already-built variants using identical measurement code, set `STARTREE_PERFORMANCE_DIST` to the absolute build directory before running a measurement script. To reproduce the slim Virtual DOM control, use a separate checkout of `f8fe6aa`, remove `vapor` from the six `<script setup>` tags, change `createVaporApp` to `createApp` in `src/client/main.ts`, and build without changing any other application code.

Vue 3.6 remains a release candidate. The official [Vapor release notes](https://github.com/vuejs/core/releases/tag/v3.6.0-rc.1) describe opt-in compilation, interoperability, and compatibility restrictions; [rc.9](https://github.com/vuejs/core/releases/tag/v3.6.0-rc.9) is the exact version used here.
