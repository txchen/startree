# Personal Features Plan

This document records three agreed features for the single-Owner Startree application. Implement them one at a time in the order below. Implementation status is recorded per feature; local implementation does not imply deployment.

GitHub Issues remain the implementation tracker. Use this document as the starting point when defining each implementation issue.

## 1. Pinned Bookmarks

**Status:** Implemented, verified, and deployed.

**Purpose:** Keep frequently used destinations immediately accessible across the Folder tree.

### Initial scope

- Allow the Owner to pin and unpin an existing Bookmark.
- Show pinned Bookmarks in a compact, dedicated area on the Bookmarks Page.
- Keep the original Bookmark in its Folder; pinning must not create a duplicate.
- Allow the Owner to arrange pinned Bookmarks manually.
- Persist pins and their order across devices through the existing cloud data store.
- Preserve the existing Folder and Bookmark ordering when pins change.

### Acceptance criteria

- A Bookmark can be opened from the pinned area without navigating to its Folder.
- Editing its title or URL is reflected in the pinned area.
- Unpinning does not delete or move the Bookmark.
- Trashed Bookmarks do not appear in the pinned area.
- Pinned Bookmarks remain available for offline browsing with the retained library.

### Implementation decisions

- Show a compact, wrapping pinned area below search while browsing Folders on desktop and mobile. Hide it while searching or reviewing Trash and duplicates.
- Pin and unpin using the star on a Bookmark card in browsing mode. Arrange pins with earlier/later buttons that support keyboard and touch input.
- Trashing a Bookmark or its Folder hides the pin; restoring it restores the pin. Permanent deletion removes it.
- Pin changes require an online connection and use revision checks to reject stale ordering changes. Retained snapshots include pins for offline browsing.

## 2. Recently Opened Bookmarks

**Status:** Implemented and locally verified. Tracked in GitHub issue #22; deployment is recorded there.

**Purpose:** Quickly return to destinations opened from Startree.

### Initial scope

- Record opening a Bookmark from Startree, including from Folder browsing, search, and the pinned area.
- Show a bounded list ordered by most recent opening.
- Reopening the same Bookmark moves it to the top instead of adding another entry.
- Track only openings initiated from Startree; do not collect general browser history.
- Keep recency separate from manual Folder, Bookmark, and pin ordering.
- Provide a way to clear the recent list.

### Acceptance criteria

- Opening a Bookmark makes it available in the recent list.
- Repeated openings do not produce duplicate entries for that Bookmark.
- Trashed Bookmarks do not appear in the recent list.
- Changes to a Bookmark's title or URL are reflected in its recent entry.
- Recording an opening does not delay navigation to the destination.

### Implementation decisions

- Keep at most 10 distinct Bookmark IDs in browser-local IndexedDB; never synchronize opening activity to the backend. The Owner selected this scope.
- Show a compact list below Pinned while browsing Folders, with website icons, title initials as fallback, URL/Note hover text, and a clear action. Hide it in search, Trash, and duplicates.
- Record primary, keyboard, modified, and middle-click openings from Bookmark cards, search, Pinned, and the recent list without intercepting native navigation. Browser context-menu openings cannot be observed reliably and are not recorded.
- Retain offline openings and refresh persistence; use atomic IndexedDB transactions for updates and synchronize updates and clearing between tabs in the same browser. If browser storage is unavailable, retain a best-effort session list and allow navigation normally.
- Resolve entries against the current active library so edits appear immediately and trashed or permanently deleted Bookmarks are hidden. Restoring a Bookmark reveals it again if its ID remains among the retained 10 entries.
- Clearing the list removes only local activity, never Bookmarks or pins.

## 3. Encrypted Quick Notes

**Status:** Planned; not implemented.

**Purpose:** Capture private personal notes with convenient cloud synchronization while keeping readable note content out of Cloudflare storage and ordinary backend processing.

### Agreed experience

- The Owner enters a separate unlock password once, then reads, edits, and searches notes during the unlocked session.
- Notes save automatically after browser-side encryption.
- Refreshing or reopening the application requires unlocking again.
- Provide manual locking and automatic locking after inactivity; choose the inactivity interval during implementation.
- Another device can unlock synchronized notes using the same password.
- Provide a recovery key that the Owner can save offline.
- Bookmark storage and browsing retain their existing behavior and do not require the notes password.

### Privacy and storage requirements

- Encrypt both note titles and bodies in the browser before upload.
- Upload neither the unlock password nor plaintext decryption keys.
- Cloudflare stores encrypted note payloads and the minimum metadata needed for synchronization and recovery.
- Persist only encrypted note content in browser storage. Keep unlocked content and plaintext keys in memory for the unlocked session.
- Search decrypted notes locally while unlocked; do not send note search terms or a plaintext search index to the backend.
- Exclude plaintext note content, passwords, and keys from logs, analytics, error reports, and diagnostics.
- Cloudflare Access remains the application access boundary. The notes password is a separate encryption boundary.

### Security boundaries

- Cloudflare-managed storage encryption alone does not meet this requirement. Encryption must happen in the browser using keys unavailable to the backend.
- Encryption does not hide all metadata, such as payload sizes, synchronization times, or potentially note counts.
- This design does not protect against a compromised device, malicious browser extensions, or modified application JavaScript that captures secrets while unlocked. The hosted web application remains part of the trust boundary.
- Losing both the password and recovery key means the notes cannot be recovered. An authentication reset must not imply that encrypted notes can be decrypted.

### Acceptance criteria

- Inspecting requests, server records, and persistent browser storage reveals no plaintext note titles or bodies.
- The backend can store and synchronize notes without decrypting them.
- The correct password unlocks existing notes on another device; an incorrect password does not.
- Notes remain editable and searchable without repeated password prompts during an unlocked session.
- Locking removes access to decrypted notes and their search index until the next successful unlock.
- Refreshing starts in the locked state without restoring a plaintext key from persistent storage.
- Recovery with the saved recovery key is verified before treating the feature as complete.
- Concurrent edits or failed saves do not silently overwrite or discard notes.

### Decide during implementation

- Note list and editor layout, with a small initial feature set focused on plain-text capture.
- Reviewed cryptographic design: password-based key derivation, authenticated encryption, random nonce generation, key wrapping, recovery, and versioned encrypted payloads. Use established cryptographic libraries or browser primitives rather than inventing cryptography.
- Password changes, recovery-key rotation, and their effects on existing devices.
- Conflict handling, offline editing, synchronization status, and encrypted export/backup behavior.
- Session behavior across browser tabs and the inactivity-lock policy.

## Delivery Order and Scope

1. Implement and verify pinned Bookmarks.
2. Implement and verify recently opened Bookmarks.
3. Finalize the encryption and recovery design, then implement and verify encrypted quick notes.

Keep each feature independently reviewable and preserve the compact Bookmark browsing experience. Multi-user features and work-scenario entry points are outside this plan. Inbox capture, smart views, and other previously suggested ideas have not been selected for this implementation sequence.
