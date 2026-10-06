# Client memory review

Baseline: `ecdbc9f`. The browser measurements use the production build, real IndexedDB and search Worker, and synthetic fixtures with 10,000 Bookmarks and 1,000 Folders. Each case runs in three fresh browser contexts. Search completes before measurement. Garbage collection runs in both the page and Worker before each sample; the tables report medians, in decimal MB.

These are retained JavaScript heap measurements, not total browser process memory. They exclude native DOM storage, image buffers, GPU memory, service workers, and transient peaks. The API is local, favicons are blocked, and production Owner data is never read. Protocol references: [Runtime.getHeapUsage](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-getHeapUsage) and [HeapProfiler.collectGarbage](https://chromedevtools.github.io/devtools-protocol/tot/HeapProfiler/#method-collectGarbage).

## Findings and changes

- Search retained both its own documents and MiniSearch's stored result fields. The index now keeps numeric document IDs, with one payload array used for filtering and result construction. Indexed fields are extracted from those payloads without retaining redundant search-only properties.
- Every Bookmark previously allocated its own ancestor list. Bookmarks in the same Folder now share one readonly list. Folder results still exclude the selected Folder itself, while Bookmark results include their containing Folder and ancestors.
- String document IDs repeated the Bookmark or Folder UUID. Index-local numeric positions now identify documents; public results still return the original UUIDs.
- Search filtering now stops after finding the result limit, instead of copying scope and Tag arrays and allocating an intermediate array for every matching document. This does not limit the searchable library or alter ranking.

Search still builds eagerly. There is no new first-query initialization delay, server search dependency, or loss of offline search.

## Measurements

Hierarchy fixture, at the root after a search:

| Retained JS heap |   Before |    After |               Reduction |
| ---------------- | -------: | -------: | ----------------------: |
| Page             |  6.31 MB |  6.31 MB | Approximately unchanged |
| Search Worker    | 15.04 MB | 11.87 MB |                   21.1% |
| Combined         | 21.35 MB | 18.18 MB |                   14.8% |

The ancestor-sharing change alone reduced Worker heap to approximately 13.73 MB. Removing duplicate result storage reduced it to approximately 12.87 MB. Numeric IDs and array lookup reduced it further to 11.87 MB.

A same-machine startup comparison using the same harness for both builds measured five-run medians of 437 ms before versus 442 ms after for cold browsing, and 242 ms versus 248 ms for retained browsing. These small samples show no substantial startup change; they are not a guarantee of identical latency. An earlier run under different machine load was slower, which is why measurements from different sessions were not used for this comparison.

The concentration fixture deliberately puts every Bookmark in one Folder:

| Phase                                    | Page heap before | Page heap after | Worker heap before | Worker heap after |
| ---------------------------------------- | ---------------: | --------------: | -----------------: | ----------------: |
| Root                                     |         10.00 MB |         9.99 MB |           14.73 MB |          11.82 MB |
| All 10,000 cards visible in the document |         65.86 MB |        65.85 MB |           14.73 MB |          11.82 MB |
| Returned to root                         |         10.16 MB |        10.16 MB |           14.73 MB |          11.82 MB |

The concentrated Folder creates approximately 185,000 DOM nodes. Returning to the root releases the card rendering and returns to approximately 22,000 nodes. This round-trip does not show those cards being retained indefinitely, but it is not a long-running leak test.

The next substantial opportunity for extremely large individual Folders is rendering only the visible cards. That requires separate design and tests for variable card height, keyboard navigation, native find, accessibility, and drag-and-drop. It is not part of this change. Normal hierarchical libraries benefit from the search memory reduction without changing their browsing behavior.

## Reproduction and coverage

```sh
npm run build
node scripts/measure-memory.mjs hierarchy
node scripts/measure-memory.mjs concentration
node scripts/measure-startup.mjs
```

The startup and memory scripts share a synthetic fixture server. Memory output includes individual samples and phase medians for the main heap, search heap, combined heap, and DOM-node counts. Compare measurements on the same browser build and machine; do not treat these samples as universal memory budgets.

Regression tests cover text search, ranking, match context, result limits, late matching filters, Folder scope, multiple Bookmarks sharing one Folder, snapshot replacement, disposal, and unreachable records. Existing browser acceptance also exercises filters, keyboard navigation, retained browsing, mutations, and offline search.

Validation before release passed formatting, lint, client and server type checks, 123 unit tests, 10 script tests, the production build, and both local Worker browser scenarios. The normal production deployment entry point repeats complete verification.

## Startup peak and URL indexing follow-up

This follow-up measured renderer process memory as well as JavaScript heap. `scripts/measure-process-memory.mjs` reads renderer private memory from `/proc`, so it runs only on Linux. It measures a cold start and a retained start with a persistent browser profile, records the peak during the first six seconds, and waits 45 seconds before the settled sample. Chromium returns freed renderer memory only after the page has been idle for about 30 seconds, so shorter waits do not show settled memory. Set `STARTREE_PERFORMANCE_DIST` to compare two builds on one machine.

With the hierarchy fixture, the renderer peaks at about 120 to 130 MB during startup and settles at about 75 to 80 MB. A blank page settles at about 32 MB. During the peak, the page heap has 28.0 MB committed for 9.5 MB used and settles at 6.9 MB committed. The search Worker heap has 30.1 MB committed for 18.5 MB used and settles at 12.6 MB committed. Most of the peak is therefore V8 heap growth during the burst of allocation from snapshot parsing and index construction, not retained data. Small allocation reductions do not change it:

- When a refresh confirms the retained revision, startup no longer rewrites the complete snapshot to IndexedDB to update its synchronization time. A small settings record now stores that time. This removes about 48 ms of synchronous main-thread serialization from every retained start and every refresh when the page becomes visible again. Alternating four-run comparisons against the previous build showed no change in renderer peak memory, at 120 to 123 MB for both builds.
- `writeSnapshot` no longer parses the snapshot again before storing it. Its callers already hold validated snapshots, and parsing copied the whole library.
- Sending the Worker a projection with only the fields search reads showed no measurable change in peak memory, so it was not kept.

The search index no longer includes the URL scheme, a leading `www.`, or query parameters. The host, path, and fragment remain searchable, and fragments stay for hash-routed applications. Result context and domain filters still use the full URL. With the hierarchy fixture, whose URLs have no query strings, Worker heap fell from 11.86 MB to 11.41 MB. In a standalone MiniSearch experiment with 10,000 synthetic URLs across 300 hosts, where 35% of URLs had tracking or ID query parameters, the index fell from 22.9 MB to 19.5 MB. Real libraries will differ. Tokens that appear only in query parameters no longer match.

Two options were considered and declined. Returning only IDs from the Worker would save an estimated 1 to 2 MB for added complexity. Starting the Worker lazily would delay the first search, which is the main action on a new-tab page.
