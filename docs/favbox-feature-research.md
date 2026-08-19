# Favbox Feature Research for Startree

Research date: 2026-08-19

Favbox revision reviewed: [`0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a`](https://github.com/dd3v/favbox/tree/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a) (`v2.2.0`)

Scope: product purpose, architecture and data ownership, user-facing behavior, search and organization, import/export and integrations, deployment, privacy and security, maturity, and features worth adapting to Startree.

## Conclusion

Favbox is most useful to Startree as a source of **workflow ideas**, not as an architecture to copy. It is a browser extension layered over the browser's native bookmark tree; Startree is a private, self-hosted workspace with D1 as its authority and a retained IndexedDB snapshot. Favbox's best ideas are the things an extension can do at the edge of the browsing workflow:

1. **Fast capture from the current tab**, including duplicate detection, Folder and Tag selection, and a direct route to an existing Bookmark.
2. **Faceted browsing** by Tag, domain, Folder, page keyword, and added date, with counts and removable query chips.
3. **Library-maintenance views**, especially exact-URL duplicate review and, with more care, an owner-triggered broken-link scan.
4. **Optional working sets**, where selected Bookmarks become a focused list with a larger Note editor.
5. **Optional visual browsing**, using page metadata and previews, but only as a secondary mode compatible with Startree's compact start-page purpose.

The recommended Startree sequence is therefore:

- First, build a narrow capture bridge and add faceted filters plus duplicate review.
- Then validate non-destructive sort/date lenses and an opt-in health check.
- Explore a pinned working set only if the Owner wants Startree to become a reading/research workspace as well as a start page.
- Defer rich previews and gallery layouts until their storage, privacy, and density costs are justified.

Do **not** copy Favbox's title-encoding trick for Tags, its browser-bookmark source-of-truth model, automatic fetching of every saved URL, separate search surfaces with different semantics, or irreversible deletion. Startree's authoritative model, complete local search, and Trash are stronger foundations.

## What Favbox is

Favbox describes itself as a local-first, experimental browser extension that extends native bookmarking rather than replacing it. Its README promises no Favbox-operated cloud storage, ads, tracking, or third-party data sharing, while using the browser profile to synchronize native bookmarks ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/README.md#L22-L36)).

That product boundary matters:

- The browser owns Bookmark identity, URL, title, Folder placement, import, and profile synchronization.
- Favbox builds a local enriched index with descriptions, domains, favicons, preview images, page keywords, Tags, Notes, pin state, and health status.
- Bookmark writes go through the WebExtension bookmarks API, while native Folder changes are observed and reflected in the local index, so the browser manager and Favbox remain interoperable ([Bookmark source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/views/BookmarksView.vue#L315-L394), [Folder-event source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/sw/index.js#L112-L180)).
- Favbox has an action popup, a full-page extension application, a background service worker, and a content script. It does not provide a hosted web service or multi-user system ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/README.md#L55-L79)).

Startree has a different center of gravity: it is already a browser-accessible, self-hosted Bookmark authority, with D1 authoritative and a compatible snapshot retained in IndexedDB for local search and offline browsing ([local source](../README.md#L31-L45)). A Favbox-inspired extension should therefore be a **capture/import client for Startree**, not a second synchronized database.

## Architecture and data model

### Native tree plus denormalized local index

Favbox reads the complete browser bookmark tree and builds Folder trees and Folder counts directly from it ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/services/browserBookmarks.js#L43-L63)). Its IndexedDB database, accessed through JsStore, has two tables:

- `bookmarks`: browser ID, Folder ID/name, title, description, domain, URL, favicon, page keywords, preview image, Tags, pin state, Note HTML, HTTP status, browser-added time, and local timestamps.
- `attributes`: a derived key/value/count table used for domain, Tag, and keyword facets.

The schema and searchable fields are explicit in the connection definition ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/storage/idb/connection.js#L27-L145)). This is a useful read-model pattern: denormalize the fields needed for discovery and aggregate facets separately. It is not a safe authority model by itself.

Initial synchronization finds browser Bookmarks missing from IndexedDB, fetches metadata with up to 80 concurrent requests and an eight-second timeout, writes in batches of 100, removes stale local rows, and rebuilds derived facets ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/sw/sync.js#L8-L50), [sync loop](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/sw/sync.js#L53-L149)). Browser create, update, move, delete, and import events then incrementally update that index ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/sw/index.js#L53-L239)).

There are two important tradeoffs in this synchronization design:

1. The initial check treats equal browser and IndexedDB counts as “already in sync,” without comparing identities or content. Equal counts can conceal drift ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/sw/sync.js#L53-L75)). Startree's revisioned snapshot and conflict-aware command model is stronger and should remain authoritative.
2. Full enrichment actively contacts every saved origin. On a large or sensitive library this creates network load and reveals that the browser is revisiting those URLs. Startree should make enrichment explicit, incremental, and privacy-labeled rather than automatic.

### Metadata enrichment

Favbox fetches saved pages and extracts description, Open Graph/Twitter images, heuristic content images, YouTube thumbnails, hostname, favicon, and meta keywords ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/parser/metadata.js#L63-L176), [entity mapping](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/parser/metadata.js#L179-L252)). When a newly created Bookmark has no page image, the service worker attempts a low-quality screenshot of the visible active tab ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/sw/index.js#L65-L109)).

This produces much richer cards than Startree's current origin favicon, title, hostname, Note, and Tags ([local source](../src/client/bookmarks/BookmarkCard.vue#L42-L64)). The cost is a larger, stale-prone local index and broad page access. A Startree version should prefer metadata supplied at capture time by an extension or browser page, with a compact text card remaining the default.

### Which data actually synchronizes

Favbox encodes Tags into the native Bookmark title after a `🏷` delimiter so the browser profile synchronizes them across devices. It strips the suffix for display and reconstructs it on write ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/README.md#L47-L52), [codec](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/services/tags.js#L1-L40)).

This is clever but leaky. Native titles become implementation storage, the format can collide with legitimate text, and Notes, pins, previews, and health data still live only in extension IndexedDB. Open import/export requests specifically report that Tag metadata is not preserved by generic browser export ([issue #12](https://github.com/dd3v/favbox/issues/12), [issue #28](https://github.com/dd3v/favbox/issues/28)). Startree should preserve structured Tags and Notes in its canonical schema and provide an explicit versioned export instead of encoding metadata into titles.

## User-facing feature inventory

### Capture and browser integration

The action popup is an effective capture flow:

- It reads the current tab's title, URL, and favicon.
- It detects whether the URL already exists in browser bookmarks.
- For a new Bookmark it offers title editing, a Folder tree picker, and Tag suggestions.
- For an existing Bookmark it offers “View in FavBox” and deep-links to that Bookmark in the full application ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/popup/PopupView.vue#L23-L80), [behavior](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/popup/PopupView.vue#L85-L142)).

The popup's form limits the quick-capture flow to five Tags and embeds them in the browser title ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/popup/components/BookmarkForm.vue#L31-L49), [submission](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/popup/components/BookmarkForm.vue#L88-L104)). The extension also registers a context-menu capture action and a browser-level shortcut for opening its popup ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/sw/index.js#L23-L51), [shortcut manifest](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/manifest.chrome.json#L23-L39)).

This is the clearest feature to adapt. Startree currently creates Bookmarks inside its Page, which is good for curation but adds navigation cost during browsing. A small “Save to Startree” extension could prefill title and URL, show recent or searched Folders and Tag suggestions, report duplicates, and deep-link to edit the existing Bookmark.

The capture implementation needs one correctness guard that Favbox lacks: when its background receives a newly created Bookmark, it asks whichever tab is currently active for HTML without first checking that the tab URL matches the new Bookmark URL ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/sw/index.js#L68-L99)). A Startree capture payload must bind metadata to the exact captured URL and discard page data if navigation changes before submission.

Keep the capture channel open, however. Favbox issue #13 proposes a PWA `share_target` for Android because mobile browsers may not support extensions ([issue #13](https://github.com/dd3v/favbox/issues/13)). That is not a Favbox feature today, but it identifies the same job from a different device: capture a shared URL with minimal context switching. Startree could eventually support both a desktop browser action and a mobile share target against one capture contract.

### Search, filters, and organization

Favbox has several complementary organization mechanisms:

- A main query bar turns submitted text into removable chips. It accepts free text or structured `tag:`, `keyword:`, `domain:`, `folder:`, and `id:` filters; `Delete` removes the last chip ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/components/SearchTerm.vue#L1-L60), [query parsing](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/components/SearchTerm.vue#L87-L147)).
- A facet sidebar lists Tags, domains, and page keywords with counts. Facet types can be included or excluded and sorted alphabetically or by count ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/components/AttributeList.vue#L1-L124), [facet rows](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/components/AttributeList.vue#L127-L175)).
- The same sidebar can switch to a hierarchical Folder tree ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/views/BookmarksView.vue#L1-L53)).
- A date-range picker adds an `added date` filter, while a separate control reverses added-date sort order ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/components/DatePicker.vue#L1-L35), [query implementation](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/storage/bookmark.js#L4-L52)).
- An `Option+K` palette searches facet values and supports keyboard selection ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/components/CommandPalette.vue#L230-L310)).

The storage query intersects Folder, Tag, domain, keyword, free-text, and date conditions. Free text uses multiword regular expressions across title, description, URL, domain, and page keywords, but not the local Note ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/storage/bookmark.js#L4-L52)). Startree already has a stronger known-item search: it ranks title, Tags, URL, and Note, includes Folders, explains non-title matches, runs in a Web Worker, and returns a bounded result set ([local source](../src/client/bookmarks/bookmark-search.ts#L9-L59), [result context](../src/client/bookmarks/bookmark-search.ts#L139-L218)).

The part to borrow is **faceted browsing**, not Favbox's search implementation. Favbox's own open issue reports that the header search and command palette have confusingly different behavior ([issue #51](https://github.com/dd3v/favbox/issues/51)). Startree should keep one search entry and optionally expose Tag/domain/date facets as discoverable chips or a compact filter popover.

### Display modes and previews

Favbox persists three display modes: responsive masonry gallery, cards, and a one-column list ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/components/ViewMode.vue#L1-L83), [layout](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/components/BookmarkLayout.vue#L1-L41)). The gallery foregrounds preview images and falls back to a large favicon over a blurred favicon backdrop, while retaining title, description, domain, date, and Tags ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/components/card/type/MasonryView.vue#L14-L113)).

This is attractive for rediscovery but conflicts with Startree's stated goal of keeping a large library compact and avoiding an unrelated dashboard feel ([local source](../README.md#L7-L9)). The measured opportunity is a two-state density choice—`Compact` and `Visual`—rather than three parallel layouts. Visual mode should be opt-in and resilient when no metadata exists.

### Notes as a focused workspace

Favbox uses a pin action to add a Bookmark to a dedicated Notes Page. That Page has a searchable list on the left and an autosaving rich-text editor on the right ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/views/NotesView.vue#L1-L78), [state and autosave](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/views/NotesView.vue#L93-L238)). The editor supports headings, emphasis, lists, code blocks, block quotes, highlighting, and stores generated HTML ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/components/TextEditor.vue#L1-L108), [editor configuration](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/components/TextEditor.vue#L130-L166)).

Startree already has a canonical plain-text Note of up to 32 KiB ([local source](../src/shared/bookmarks/contracts.ts#L24-L43)). The promising idea is not rich HTML by itself; it is a **focused working set** that lets the Owner collect and annotate a few Bookmarks without moving them out of their Folders. A `Pinned` or `Working Set` lens could reuse the existing Note first. Rich text should wait for a domain decision about Note format, sanitization, export, and offline conflict behavior.

Favbox also writes the Note on every editor-model change without a debounce ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/views/NotesView.vue#L220-L236)). Startree should reuse its conflict-aware operation boundary and explicitly design autosave timing, offline edits, and switching between Bookmarks rather than copying that persistence loop.

### Duplicate review and link health

Favbox has two dedicated maintenance Pages:

- Duplicate detection groups Bookmarks by exact URL, shows each group with Folder and added-time context, and lets the owner delete individual duplicates ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/storage/bookmark.js#L75-L105), [review UI](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/views/DuplicatesView.vue#L1-L90)).
- Health Check sends `HEAD` requests, retries a `404` with `GET`, stores selected failure statuses, shows progress, and supports deletion ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/views/HealthCheckView.vue#L105-L177), [HTTP client](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/services/httpClient.js#L3-L58)).

Exact duplicate review is a strong, low-risk Startree feature if it is advisory and deletion continues to use Trash. Start with exact canonical URL equality and show why records differ: Folder, title, Tags, Note, and timestamps. Do not silently merge them because Startree intentionally allows multiple Bookmarks to share a URL.

Health checking needs a fresh design. Authenticated sites, bot protection, redirects, expiring URLs, and servers that reject `HEAD` create false positives. The Favbox scan also only writes failing statuses during a scan; successful rechecks are not reset in the scan loop, even though storage has a separate `setOK` helper ([scan source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/views/HealthCheckView.vue#L124-L171), [storage helper](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/storage/bookmark.js#L158-L178)). Borrow the owner-triggered, progress-reporting review workflow, not that state transition. Prefer a browser-side checker or a carefully constrained queue over arbitrary server-side fetches from the Startree Worker.

### Preferences and deletion

Favbox `v2.2.0` added a settings modal for light/dark/system theme, small/medium/large font scale, and an option to suppress delete confirmation ([release](https://github.com/dd3v/favbox/releases/tag/v2.2.0), [settings source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/components/AppSettings.vue#L40-L165)). The font scale is applied by rewriting CSS text-size variables and preferences are retained locally ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/composables/useAppSettings.js#L1-L30)). Theme and comfortable density are reasonable Startree settings after the primary workflows stabilize.

Favbox deletion is immediate in the native browser and explicitly cannot be undone ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/views/BookmarksView.vue#L125-L143), [delete behavior](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/browser/views/BookmarksView.vue#L315-L347)). Startree's Trash, undo, restore, and conflict-aware writes are materially safer; retain them for duplicate and health workflows too ([local source](../src/client/bookmarks/BookmarksPage.vue#L765-L813), [Trash UI](../src/client/bookmarks/BookmarksPage.vue#L899-L940)).

## Import, export, and integrations

Favbox does not implement a distinct file import/export format at the reviewed revision. It observes native browser import start/end events and resynchronizes after the browser completes an import ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/sw/index.js#L227-L239)). This gives it compatibility with standard browser Bookmark HTML for titles, URLs, and Folders, but not a complete backup of Favbox enrichment.

The issue tracker makes the resulting gap unusually clear:

- Tag-preserving import/export has been requested since 2024 and remains open ([issue #12](https://github.com/dd3v/favbox/issues/12), [issue #28](https://github.com/dd3v/favbox/issues/28)).
- Cross-browser WebDAV synchronization remains a request rather than an implemented integration ([issue #38](https://github.com/dd3v/favbox/issues/38)).
- OneTab import and a non-Bookmark temporary-link store are also requests, not current features ([issue #34](https://github.com/dd3v/favbox/issues/34)).
- A local API/MCP companion is proposed but not implemented ([issue #68](https://github.com/dd3v/favbox/issues/68)).

These are not just unrelated feature requests. Together they ask for an open, complete, automatable data boundary: owner-controlled backup, migration between browsers, and access from other tools. The lesson for Startree is to make a versioned, round-trippable export of Folders, Bookmarks, Tags, Notes, ordering, and future enrichment a prerequisite for major metadata expansion. Browser HTML import can still be a convenience path, but it should not become the canonical backup format. Startree's existing validated commands and snapshot contract are a useful internal seam for later CLI or MCP adapters; the external adapter itself does not yet have enough evidence to prioritize.

## Deployment, privacy, and security

Favbox is distributed as a Chrome extension and can be built and loaded unpacked; its Firefox build is explicitly work in progress ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/README.md#L94-L109)). There is no server deployment, account, or application authentication boundary. Installation grants the extension its authority.

Its privacy claim is credible in the narrow sense that Favbox has no application backend and stores enrichment in local IndexedDB. It still has a broad browser capability surface:

- `bookmarks`, `activeTab`, `tabs`, `storage`, `alarms`, and `contextMenus` permissions.
- Host permission and a content script for `<all_urls>`.
- A content script that maintains an extension port and can return the current page's `<head>` HTML.
- Direct network requests to saved destinations and remote preview/favicons ([manifest](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/manifest.chrome.json#L6-L60), [content script](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/src/ext/content/content.js#L1-L29)).

These permissions are understandable for full-browser synchronization and metadata extraction, but a Startree capture bridge can be narrower. Its first version should need only current-tab access plus the minimum Startree origin access; native bookmark-tree permission should be reserved for an explicit import/sync mode. Metadata should be transmitted only after an Owner action, and credentials, document bodies, and private page text should never be captured.

For Startree itself, keep Cloudflare Access as the whole-application remote boundary, D1 authoritative, API responses private/non-cacheable, and diagnostics free of Bookmark content ([local source](../README.md#L87-L110)). A browser extension must not weaken those guarantees or introduce a second long-lived secret without a clear revocation model.

## Maturity and notable tradeoffs

Favbox is more mature than the word “experimental” alone suggests, but it remains a focused side project rather than a hardened bookmark platform.

- Development began in late 2022, `v2.0.0` shipped a redesigned application, command palette, Health Check, local Notes, and expanded attributes in June 2025, and `v2.2.0` shipped settings and sync performance changes in July 2026 ([first commit](https://github.com/dd3v/favbox/commit/7078ce2cdfbca22ea043a6085a790451e8003d73), [v2.0.0 release](https://github.com/dd3v/favbox/releases/tag/v2.0.0), [v2.2.0 release](https://github.com/dd3v/favbox/releases/tag/v2.2.0)).
- The reviewed package exposes build, lint, unit-test, and integration-test commands ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/package.json#L1-L12)). The repository's test surface is concentrated on bookmark-tree helpers, metadata parsing, Tag encoding, hashing, and live HTTP behavior; UI, IndexedDB synchronization, health transitions, and full extension acceptance are not covered by equivalent end-to-end tests in the reviewed tree ([test directory](https://github.com/dd3v/favbox/tree/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/tests)).
- Cross-browser behavior is aspirational: a Firefox manifest exists, but the README still labels Firefox testing WIP ([source](https://github.com/dd3v/favbox/blob/0558870a29d8a6ae03ffb45dc1a79e40e32b4a6a/README.md#L98-L109)).
- The metadata-rich model creates value for rediscovery but also causes the largest reliability and privacy burden: CORS failures, stale previews, blocked requests, screenshots, and high-concurrency initial scans.
- The product has two kinds of locality. Bookmark title/URL/Folder and encoded Tags can follow the browser profile; Notes, pins, previews, and health results are only in extension-local IndexedDB. “Local-first” therefore does not mean all Favbox data is automatically portable or recoverable.

Startree should borrow Favbox's product experiments while keeping Startree's stricter verification, explicit data authority, recoverable deletion, offline snapshot compatibility, and deployment safety.

## Feature decisions for Startree

| Candidate                          | Favbox evidence                                                                                        | Current Startree position                                                                | Recommendation                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current-tab capture bridge         | Popup prefills current tab, detects an existing URL, selects Folder/Tags, and deep-links to the record | Creation exists only inside the Bookmarks Page                                           | **Build first.** A narrow extension or browser action is the highest-leverage borrowed workflow. Keep D1 authoritative.                                         |
| Mobile share-target capture        | Requested as a PWA path for browsers without extension support                                         | Startree is a web application but not currently a share target                           | **Keep in the capture design.** Use the same capture contract; implement only after desktop capture validates the workflow.                                     |
| Tag/domain/date facets with counts | Attribute table, sidebar facets, chips, and date range                                                 | Full-text search is strong; Tag browsing and domain/date lenses are not first-class      | **Build first.** Add compact optional filters to the existing search, not another search mode. Derive domain locally.                                           |
| Duplicate review                   | Exact-URL groups with per-record review                                                                | Duplicate URLs are valid but there is no audit view                                      | **Build first.** Advisory exact-match groups, then optional normalization. Delete only through Trash.                                                           |
| Sort lenses                        | Added-date ascending/descending plus facet sorting                                                     | Canonical manual rank controls display                                                   | **Explore soon.** Add temporary `Manual / Added / Modified / Title / Domain` views that never rewrite rank.                                                     |
| Broken-link health                 | Owner-triggered scan with progress and status review                                                   | No health state or outbound scan                                                         | **Prototype carefully.** Browser-side, rate-limited, cancellable, and advisory; distinguish unreachable, authentication-required, and confirmed gone.           |
| Pinned working set / Notes Page    | Pin action plus searchable list and rich autosaving editor                                             | Every Bookmark already has a searchable plain-text Note                                  | **Validate demand.** Start with `Pinned` plus the existing Note; avoid changing Note format until the workflow proves useful.                                   |
| Inbox / read-later lifecycle       | Requested as a temporary-link store that does not clutter native bookmarks                             | Every saved destination is currently a Bookmark in a Folder                              | **Discuss, do not assume.** This may be a genuinely different lifecycle, but it expands the domain beyond Bookmarks and needs a clear promotion/deletion model. |
| Visual mode and metadata           | Gallery/cards/list plus description, image, keyword, favicon, screenshot                               | Compact cards and origin favicon fit start-page density                                  | **Later.** Offer one optional Visual mode and capture-time metadata. Do not automatically crawl the entire library.                                             |
| Theme and text scale               | Light/dark/system and three font scales                                                                | Current interface has one visual configuration                                           | **Later, low risk.** Useful accessibility preference, but less important than capture and organization.                                                         |
| Versioned import/export            | Favbox lacks a complete format; repeated open issues request it                                        | Snapshot wire format exists internally but no owner-facing backup workflow is documented | **Treat as enabling work.** Add explicit round-trip export before storing previews, health history, or richer Notes.                                            |
| Browser-native source of truth     | Native bookmark tree plus event mirror                                                                 | D1 is authoritative and cross-browser                                                    | **Do not copy.** An extension may import or capture, never silently reconcile two authorities.                                                                  |
| Tags encoded into title            | `🏷 #tag` suffix piggybacks browser sync                                                                | Tags are structured canonical records                                                    | **Do not copy.** Preserve clean titles and explicit Tag semantics.                                                                                              |
| Separate command-palette search    | Palette searches attributes, header searches Bookmarks                                                 | One global keyboard-first search already covers all relevant fields                      | **Do not copy.** The divergent semantics are already a reported Favbox problem.                                                                                 |

## Suggested product discussion

The main product choice is whether Startree should remain primarily a **fast destination launcher** or also become a **capture and research workspace**.

- If it remains a launcher, prioritize capture, facets, duplicate review, and temporary sort lenses. These improve the Bookmark lifecycle without changing the product's center.
- If it expands into research, a pinned working set, larger Note editor, import/export, and optional previews form a coherent second Page. They should arrive together as a deliberate workflow rather than as isolated card decoration.
- In either direction, a capture bridge is valuable. It connects the moment a page is discovered to Startree without requiring Startree to become the browser's native bookmark database.

My default recommendation is the first path now, while designing the capture payload and export format so the richer path remains open.

## Source limitations

The review used Favbox's first-party repository at a fixed commit, first-party releases, and its GitHub issue tracker. Issue bodies establish reported needs or problems, not verified implementation behavior. Chrome Web Store behavior was not used where repository source was available. Statements about missing features describe the reviewed revision and public issue state, not private branches or future plans. Local Startree links describe the workspace on the research date and may move as implementation changes.
