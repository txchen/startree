-- startree: expand-contract-compatible
CREATE TABLE bookmark_command_assertions (
  operation_id TEXT PRIMARY KEY NOT NULL,
  valid INTEGER NOT NULL CHECK (valid = 1)
) WITHOUT ROWID;
