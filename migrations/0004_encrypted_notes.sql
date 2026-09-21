-- startree: expand-contract-compatible
-- Only opaque encrypted vaults and synchronization metadata are stored here.
CREATE TABLE encrypted_notes_vault (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL CHECK (revision > 0),
  operation_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ciphertext_json TEXT NOT NULL
);
