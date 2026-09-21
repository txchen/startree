# Startup review

Reviewed the startup, retained-snapshot navigation, search initialization, and snapshot refresh paths against baseline commit `4600727`.

## Findings and changes

1. **Cold browsing waited for search indexing.** `promote()` installed the snapshot but left the state loading until the search Worker completed. It now publishes the selected Folder after the snapshot is retained successfully. Search still builds eagerly and handles queries through the existing Worker. Snapshot validation and durable retention remain on the startup path.
2. **Retained browsing was visible before navigation was enabled.** The Page ignored route changes until `initialize()` finished its network refresh. Initialization could also overwrite a Folder selected during that refresh. The Page now enables navigation and restores the remembered route when the first usable state arrives; the state module no longer reapplies the initial selection after refresh. A missing explicit Folder can still become available when the fresh snapshot arrives.

Regression coverage checks publication before indexing completes, navigation during a pending refresh, and recovery of an explicit Folder absent from retained data. Browser acceptance holds the startup response pending, navigates to another Folder, and verifies the selection survives refresh completion and reload.

Validation passed: formatting, lint, client and server type checks, 120 unit tests, 10 script tests, production build, migration checks, environment isolation, performance fixtures, and both local Worker browser scenarios. The aggregate run encountered an unrelated service on port 8788; the management scenario passed separately with `STARTREE_VERIFY_MANAGEMENT_PORT=18788 node scripts/verify-local-worker.mjs management`. The browsing scenario passed on its default port. Both scenario ports can now be overridden with `STARTREE_VERIFY_MANAGEMENT_PORT` and `STARTREE_VERIFY_BROWSING_PORT`.

## Measurements

The local harness uses the production client build, headless Chromium, real IndexedDB, the real search Worker, and the existing synthetic hierarchy fixture: 10,000 Bookmarks and 1,000 Folders. Each case has five fresh browser contexts, each followed by one retained reload. Node.js: `24.13.0`.

The metric is elapsed browser navigation time until the first Folder tile is inserted into the DOM. It is not LCP or a production network measurement. The snapshot API is served locally, service workers are disabled, and Cloudflare Access and D1 latency are excluded.

| Case                                                       | Baseline median | Updated median |
| ---------------------------------------------------------- | --------------: | -------------: |
| Cold browsing                                              |          652 ms |         442 ms |
| Retained browsing                                          |          244 ms |         242 ms |
| Cold browsing with indexing submission delayed by 1 second |        1,640 ms |         417 ms |

Cold browsing improved about 32% in this sample. Retained first-content time did not materially improve. The injected delay demonstrates that indexing no longer gates cold content; it is a diagnostic experiment, not a real-world speedup claim. Small timing differences between the normal and delayed cases are not evidence of a separate improvement.

To repeat after building:

```sh
npm run build
node scripts/measure-startup.mjs
```

## Remaining opportunities

- `src/server/app/create-app.ts` reads and validates the full snapshot before comparing its ETag. A revision-only conditional check could avoid full-library reads for unchanged startup refreshes. Measure this separately against D1 and preserve revision consistency.
- `src/client/bookmarks/bookmark-state.ts` rewrites the complete retained snapshot after a 304 just to update its synchronization timestamp. A metadata-only storage operation could reduce write amplification, with tests for concurrent tabs and snapshot replacement.
- `src/client/bookmarks/FolderTree.vue` repeatedly scans the Folder array for children. A shared parent-to-children index may help wide or heavily expanded trees. Profile those cases before changing the tree interface.

These opportunities were identified by inspection and are not included in the measured speedup.
