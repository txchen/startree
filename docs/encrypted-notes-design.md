# Encrypted Notes

The Owner approved UI concept A in issue #23: a compact list/editor Notes Page, centered Bookmarks/Notes navigation, and no Notes loading on the default Bookmark startup path. The throwaway source remains on `prototype/encrypted-notes-ui`; production code is implemented separately.

## Cryptography and trust boundary

The browser uses Web Crypto, with no added crypto dependency. Each notebook has a random 256-bit data key. Notes, including titles, bodies, IDs, and per-note edit dates, form one versioned JSON payload encrypted with AES-256-GCM. Every encryption uses a fresh random 96-bit IV and a 128-bit authentication tag. Associated data binds the format version, vault ID, and envelope purpose to prevent swapping content and key envelopes. These choices follow the browser [AES-GCM parameters](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams).

The password derives a wrapping key using PBKDF2-HMAC-SHA-256, 600,000 iterations, and a random 128-bit salt. This work factor follows the current [OWASP PBKDF2 guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#pbkdf2); PBKDF2 is used for the native browser implementation, not as a claim of FIPS certification. Passwords require at least 12 characters, are not normalized, and are never uploaded. A separate random 256-bit recovery key wraps the same data key. The Owner must verify the saved recovery key by actually decrypting the envelope before setup completes. Plaintext key buffers are cleared after import; unlocked CryptoKeys are non-extractable.

Changing the password or recovering notes creates a new data key, vault ID, salt, password envelope, and recovery key, and re-encrypts the notebook. The current draft must be synchronized first. Revision checks prevent a concurrent edit being overwritten by credential rotation. Other open sessions detect the changed vault ID and require unlocking again. Rotation does not revoke previously exported backups or keys on a compromised device; older local drafts can require the old password.

Cloudflare receives ciphertext, encrypted key envelopes, salt, KDF parameters, vault ID, revision, operation ID, and a synchronization timestamp. It can observe payload sizes and synchronization timing. It does not receive note titles/bodies, individual note IDs, the password, the recovery key, or plaintext data keys. The hosted JavaScript, browser, and device remain trusted: this is protection against reading stored data, not against malicious application code capturing an unlocked session. This implementation is covered by tests and code review, not an independent cryptographic audit.

## Bounded notebook and synchronization

The first version supports 500 plain-text notes, 300 characters per title, 100,000 characters per body, and 512 KiB of total serialized plaintext. Encrypting a bounded whole notebook keeps titles and metadata private and simplifies atomic recovery. Large attachments and rich-text documents are outside this release.

D1 stores one opaque vault row, independently of Bookmarks. Atomic compare-and-swap writes require the expected revision. Setup cannot overwrite an existing vault. Retrying the last acknowledged operation is idempotent, while a stale operation returns a conflict. The same-origin JSON endpoint has bounded body reading, existing mutation rate limiting, and `private, no-store` responses. Cloudflare Access protects it under the existing whole-application policy.

Autosave waits for 2 seconds without typing, with a 15-second maximum interval during continued typing. Locking, leaving Notes, and explicit save/recovery operations flush immediately. Cloud retry checks run every 20 seconds while visible and unlocked; they do not bypass the typing debounce.

Each tab retains its own encrypted pending draft in the `startree-notes` IndexedDB database before cloud synchronization. Notes can be read and edited offline after the Notes assets and encrypted copy have been retained. Refresh begins locked; the unlock form lists unsynced local drafts separately from the cloud copy. In-memory state is not a durable save: navigation/refresh protection remains active until the latest encrypted draft has been retained. Unrecoverable storage failures do not silently discard edits.

Conflict resolution is explicit. “Keep both versions” reads the latest cloud copy and preserves differing local notes as named copies before attempting another revision-checked save. Local deletions are not automatically imposed on a newer cloud version. A changed encryption key requires unlocking the new cloud copy; older encrypted drafts remain recoverable separately. Encrypted backups can be exported/imported without writing plaintext files. Backups still require the matching password or recovery key.

## Sessions and UI

Notes is a separate Page. Desktop uses a compact list/editor split; mobile navigates from list to editor. Search runs over decrypted in-memory content only. Titles, bodies, search text, and password input are removed from the rendered UI when locked. Manual locking and leaving Notes first retain pending edits. Refresh/reopen requires unlocking. Inactivity locks after 15 minutes, including an elapsed-time check when a suspended tab becomes visible. If browser storage cannot retain the newest edits, locking must not discard them; manual locking reports the failure so the Owner can retry or export an encrypted backup. Failed automatic locking hides the editor behind a password prompt while retaining the unsaved in-memory session; it does not falsely claim that the encryption key has been discarded. Logging out warns before clearing unsynced local drafts and removes the Notes database along with other retained data.

## Loading boundary and verification

The app shell dynamically imports NotesPage and the Notes storage helper only on demand. Notes CSS and cryptography stay behind that import. Workbox excludes all Notes chunks from precaching; a separate bounded runtime asset cache stores them only after use. Notes API responses and plaintext never enter Cache Storage. A failed lazy import shows a retry action while Bookmarks remains available.

`verify-notes-loading.mjs` audits the build manifest, enforces an entry-bundle budget, and rejects Notes assets in the precache manifest. Real-browser acceptance observes requests with a service worker installed and proves Bookmark startup requests neither Notes assets nor its API. It also exercises setup, actual recovery verification, wrong passwords, ciphertext-only network and local persistence, offline reload, competing edits, key rotation, locking, and mobile layout. Crypto tests cover authentication failures, fresh IVs, format rejection, and password/recovery independence. Session tests cover durable drafts, storage failure, stale writes, and late asynchronous unlock completion.
