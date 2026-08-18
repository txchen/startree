-- startree: expand-contract-compatible
PRAGMA foreign_keys = ON;

CREATE TABLE bookmark_folders (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) <= 256),
  parent_id TEXT REFERENCES bookmark_folders(id),
  rank TEXT NOT NULL,
  created_at TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  trashed_at TEXT,
  trash_root_id TEXT REFERENCES bookmark_folders(id),
  original_parent_id TEXT REFERENCES bookmark_folders(id),
  original_rank TEXT,
  CHECK (id = '00000000-0000-4000-8000-000000000000' OR length(trim(name)) > 0),
  CHECK (id != parent_id),
  CHECK (trashed_at IS NULL OR id != '00000000-0000-4000-8000-000000000000')
);

CREATE UNIQUE INDEX bookmark_folders_active_sibling_name
  ON bookmark_folders(parent_id, name)
  WHERE trashed_at IS NULL AND trash_root_id IS NULL;
CREATE INDEX bookmark_folders_parent_rank ON bookmark_folders(parent_id, rank);
CREATE INDEX bookmark_folders_trash_root ON bookmark_folders(trash_root_id);

CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY NOT NULL,
  folder_id TEXT NOT NULL REFERENCES bookmark_folders(id),
  url TEXT NOT NULL CHECK (length(url) BETWEEN 1 AND 8192),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 256),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 32768),
  rank TEXT NOT NULL,
  created_at TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  trashed_at TEXT,
  trash_root_id TEXT REFERENCES bookmark_folders(id),
  original_folder_id TEXT REFERENCES bookmark_folders(id),
  original_rank TEXT
);

CREATE INDEX bookmarks_folder_rank ON bookmarks(folder_id, rank);
CREATE INDEX bookmarks_trash_root ON bookmarks(trash_root_id);

CREATE TABLE bookmark_tags (
  bookmark_id TEXT NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  display_value TEXT NOT NULL CHECK (length(trim(display_value)) > 0 AND length(display_value) <= 64),
  lowercase_key TEXT NOT NULL,
  PRIMARY KEY (bookmark_id, lowercase_key)
) WITHOUT ROWID;

CREATE TABLE bookmark_sequences (
  folder_id TEXT NOT NULL REFERENCES bookmark_folders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('folders', 'bookmarks')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (folder_id, kind)
) WITHOUT ROWID;

CREATE TABLE bookmark_domain_state (
  name TEXT PRIMARY KEY NOT NULL CHECK (name = 'bookmarks'),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
) WITHOUT ROWID;

CREATE TABLE bookmark_idempotency_results (
  operation_id TEXT PRIMARY KEY NOT NULL,
  command_type TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX bookmark_idempotency_results_expiry ON bookmark_idempotency_results(expires_at);

INSERT INTO bookmark_folders (
  id, name, parent_id, rank, created_at, modified_at, version
) VALUES (
  '00000000-0000-4000-8000-000000000000',
  '',
  NULL,
  '0',
  '1970-01-01T00:00:00.000Z',
  '1970-01-01T00:00:00.000Z',
  1
);

INSERT INTO bookmark_sequences (folder_id, kind, version) VALUES
  ('00000000-0000-4000-8000-000000000000', 'folders', 1),
  ('00000000-0000-4000-8000-000000000000', 'bookmarks', 1);

INSERT INTO bookmark_domain_state (name, revision) VALUES ('bookmarks', 0);
