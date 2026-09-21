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
