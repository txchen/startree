import * as v from 'valibot';
import {
  BOOKMARK_SNAPSHOT_WIRE_FORMAT_VERSION,
  BOOKMARK_TRASH_WIRE_FORMAT_VERSION,
  bookmarkSnapshotSchema,
  bookmarkTrashSchema,
  type Bookmark,
  type BookmarkFolder,
  type BookmarkSnapshot,
  type BookmarkTag,
  type BookmarkTrash,
} from '../../shared/bookmarks/contracts';
import type {
  BookmarkDatabase,
  BookmarkDatabaseResult,
  BookmarkDatabaseStatement,
} from './bookmark-database';

export type SnapshotRow = Record<string, string | number | null>;
export type FolderRow = BookmarkFolder & { parentId: string | null };
export type BookmarkRow = Bookmark;
export type SequenceRow = { folderId: string; folderVersion: number; bookmarkVersion: number };
export type RevisionRow = { revision: number };

const MAX_FOLDER_DEPTH = 10;

export const rowsAt = (
  results: BookmarkDatabaseResult<SnapshotRow>[],
  index: number,
): SnapshotRow[] => results[index]?.results ?? [];

export const readSnapshot = async (database: BookmarkDatabase): Promise<BookmarkSnapshot> => {
  const results = await database.batch<SnapshotRow>([
    database.prepare(
      `SELECT revision
         FROM bookmark_domain_state
        WHERE name = 'bookmarks'`,
    ),
    database.prepare(
      `SELECT id,
              name,
              parent_id AS parentId,
              rank,
              created_at AS createdAt,
              modified_at AS modifiedAt,
              version
         FROM bookmark_folders
        WHERE trashed_at IS NULL AND trash_root_id IS NULL
        ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, parent_id, rank, id`,
    ),
    database.prepare(
      `SELECT bookmarks.id,
              bookmarks.folder_id AS folderId,
              bookmarks.url,
              bookmarks.title,
              bookmarks.note,
              bookmarks.rank,
              bookmarks.pin_rank AS pinRank,
              bookmarks.created_at AS createdAt,
              bookmarks.modified_at AS modifiedAt,
              bookmarks.version AS version
         FROM bookmarks
         JOIN bookmark_folders ON bookmark_folders.id = bookmarks.folder_id
        WHERE bookmarks.trashed_at IS NULL
          AND bookmarks.trash_root_id IS NULL
          AND bookmark_folders.trashed_at IS NULL
          AND bookmark_folders.trash_root_id IS NULL
        ORDER BY bookmarks.folder_id, bookmarks.rank, bookmarks.id`,
    ),
    database.prepare(
      `SELECT bookmark_tags.bookmark_id AS bookmarkId,
              bookmark_tags.display_value AS value
         FROM bookmark_tags
         JOIN bookmarks ON bookmarks.id = bookmark_tags.bookmark_id
         JOIN bookmark_folders ON bookmark_folders.id = bookmarks.folder_id
        WHERE bookmarks.trashed_at IS NULL
          AND bookmarks.trash_root_id IS NULL
          AND bookmark_folders.trashed_at IS NULL
          AND bookmark_folders.trash_root_id IS NULL
        ORDER BY bookmark_tags.bookmark_id, bookmark_tags.lowercase_key, bookmark_tags.display_value`,
    ),
    database.prepare(
      `SELECT bookmark_sequences.folder_id AS folderId,
              MAX(CASE WHEN kind = 'folders' THEN bookmark_sequences.version END) AS folderVersion,
              MAX(CASE WHEN kind = 'bookmarks' THEN bookmark_sequences.version END) AS bookmarkVersion
         FROM bookmark_sequences
         JOIN bookmark_folders ON bookmark_folders.id = bookmark_sequences.folder_id
        WHERE bookmark_folders.trashed_at IS NULL
          AND bookmark_folders.trash_root_id IS NULL
        GROUP BY bookmark_sequences.folder_id
       HAVING COUNT(*) = 2
        ORDER BY bookmark_sequences.folder_id`,
    ),
  ]);

  const revision = rowsAt(results, 0)[0]?.revision;
  return v.parse(bookmarkSnapshotSchema, {
    wireFormatVersion: BOOKMARK_SNAPSHOT_WIRE_FORMAT_VERSION,
    revision,
    folders: rowsAt(results, 1),
    bookmarks: rowsAt(results, 2),
    tags: rowsAt(results, 3),
    sequences: rowsAt(results, 4),
  });
};

export const readTrash = async (database: BookmarkDatabase): Promise<BookmarkTrash> => {
  const results = await database.batch<SnapshotRow>([
    database.prepare("SELECT revision FROM bookmark_domain_state WHERE name = 'bookmarks'"),
    database.prepare(
      `SELECT 'folder' AS kind, id, trashed_at AS deletedAt,
              original_parent_id AS originalParentId, original_rank AS originalRank
         FROM bookmark_folders WHERE trashed_at IS NOT NULL
        UNION ALL
       SELECT 'bookmark' AS kind, id, trashed_at AS deletedAt,
              original_folder_id AS originalParentId, original_rank AS originalRank
         FROM bookmarks WHERE trashed_at IS NOT NULL
        ORDER BY deletedAt DESC, id`,
    ),
    database.prepare(
      `SELECT id, name, parent_id AS parentId, rank, created_at AS createdAt,
              modified_at AS modifiedAt, version
         FROM bookmark_folders
        WHERE trashed_at IS NOT NULL OR trash_root_id IS NOT NULL
        ORDER BY COALESCE(trash_root_id, id), parent_id, rank, id`,
    ),
    database.prepare(
      `SELECT id, folder_id AS folderId, url, title, note, rank, pin_rank AS pinRank,
              created_at AS createdAt, modified_at AS modifiedAt, version
         FROM bookmarks
        WHERE trashed_at IS NOT NULL OR trash_root_id IS NOT NULL
        ORDER BY COALESCE(trash_root_id, id), folder_id, rank, id`,
    ),
    database.prepare(
      `SELECT bookmark_tags.bookmark_id AS bookmarkId, bookmark_tags.display_value AS value
         FROM bookmark_tags JOIN bookmarks ON bookmarks.id = bookmark_tags.bookmark_id
        WHERE bookmarks.trashed_at IS NOT NULL OR bookmarks.trash_root_id IS NOT NULL
        ORDER BY bookmark_tags.bookmark_id, bookmark_tags.lowercase_key`,
    ),
  ]);
  return v.parse(bookmarkTrashSchema, {
    wireFormatVersion: BOOKMARK_TRASH_WIRE_FORMAT_VERSION,
    revision: rowsAt(results, 0)[0]?.revision,
    roots: rowsAt(results, 1),
    folders: rowsAt(results, 2),
    bookmarks: rowsAt(results, 3),
    tags: rowsAt(results, 4),
  });
};

export const FOLDER_COLUMNS = `id, name, parent_id AS parentId, rank, created_at AS createdAt,
                        modified_at AS modifiedAt, version`;
export const BOOKMARK_COLUMNS = `id, folder_id AS folderId, url, title, note, rank, pin_rank AS pinRank,
                          created_at AS createdAt, modified_at AS modifiedAt, version`;
export const ACTIVE_ROW = 'trashed_at IS NULL AND trash_root_id IS NULL';
export const ACTIVE_BOOKMARK = `${ACTIVE_ROW} AND EXISTS (
  SELECT 1 FROM bookmark_folders WHERE id = bookmarks.folder_id AND ${ACTIVE_ROW}
)`;

export const revisionStatement = (database: BookmarkDatabase) =>
  database.prepare("SELECT revision FROM bookmark_domain_state WHERE name = 'bookmarks'");

export const folderStatement = (database: BookmarkDatabase, folderId: string) =>
  database
    .prepare(`SELECT ${FOLDER_COLUMNS} FROM bookmark_folders WHERE id = ? AND ${ACTIVE_ROW}`)
    .bind(folderId);

export const bookmarkStatement = (database: BookmarkDatabase, bookmarkId: string) =>
  database
    .prepare(`SELECT ${BOOKMARK_COLUMNS} FROM bookmarks WHERE id = ? AND ${ACTIVE_BOOKMARK}`)
    .bind(bookmarkId);

export const bookmarkTagsStatement = (
  database: BookmarkDatabase,
  where: string,
  values: string[],
) =>
  database
    .prepare(
      `SELECT bookmark_id AS bookmarkId, display_value AS value FROM bookmark_tags
        WHERE ${where} ORDER BY bookmark_id, lowercase_key`,
    )
    .bind(...values);

export const chunkIds = (ids: string[]): string[][] => {
  const chunks: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += 80) {
    chunks.push(ids.slice(offset, offset + 80));
  }
  return chunks;
};

export const placeholders = (ids: string[]) => ids.map(() => '?').join(', ');

export const readRows = async <Row>(
  database: BookmarkDatabase,
  statements: BookmarkDatabaseStatement[],
): Promise<Row[]> =>
  statements.length ? (await database.batch<Row>(statements)).flatMap((row) => row.results) : [];

export const readBookmarkTags = (
  database: BookmarkDatabase,
  ids: string[],
): Promise<BookmarkTag[]> =>
  readRows(
    database,
    chunkIds([...ids].sort()).map((chunk) =>
      bookmarkTagsStatement(database, `bookmark_id IN (${placeholders(chunk)})`, chunk),
    ),
  );

export const sequenceStatement = (database: BookmarkDatabase, folderId: string) =>
  database
    .prepare(
      `SELECT folder_id AS folderId,
              MAX(CASE WHEN kind = 'folders' THEN version END) AS folderVersion,
              MAX(CASE WHEN kind = 'bookmarks' THEN version END) AS bookmarkVersion
         FROM bookmark_sequences
        WHERE folder_id = ? AND EXISTS (
          SELECT 1 FROM bookmark_folders WHERE id = bookmark_sequences.folder_id AND ${ACTIVE_ROW}
        )
        GROUP BY folder_id
       HAVING COUNT(*) = 2`,
    )
    .bind(folderId);

const folderDepth = async (database: BookmarkDatabase, folderId: string): Promise<number> => {
  const row = await database
    .prepare(
      `WITH RECURSIVE ancestors(id, parent_id, depth) AS (
         SELECT id, parent_id, 0 FROM bookmark_folders WHERE id = ?
         UNION ALL
         SELECT parent.id, parent.parent_id, child.depth + 1
         FROM bookmark_folders parent JOIN ancestors child ON parent.id = child.parent_id
       ) SELECT MAX(depth) AS depth FROM ancestors`,
    )
    .bind(folderId)
    .first<{ depth: number | null }>();
  return row?.depth ?? 0;
};

export const folderSubtreeHeight = async (
  database: BookmarkDatabase,
  folderId: string,
  trashRootId: string | null = null,
): Promise<number> => {
  const row = await database
    .prepare(
      `WITH RECURSIVE descendants(id, depth) AS (
         SELECT id, 0 FROM bookmark_folders WHERE id = ?
         UNION ALL
         SELECT child.id, parent.depth + 1 FROM bookmark_folders child
         JOIN descendants parent ON child.parent_id = parent.id
         WHERE child.trashed_at IS NULL AND child.trash_root_id IS ?
       ) SELECT MAX(depth) AS height FROM descendants`,
    )
    .bind(folderId, trashRootId)
    .first<{ height: number | null }>();
  return row?.height ?? 0;
};

export const exceedsFolderDepth = async (
  database: BookmarkDatabase,
  destinationId: string,
  subtreeHeight: number | Promise<number> = 0,
): Promise<boolean> => {
  const [depth, height] = await Promise.all([folderDepth(database, destinationId), subtreeHeight]);
  return depth + 1 + height > MAX_FOLDER_DEPTH;
};

export const pruneExpiredResults = (database: BookmarkDatabase, timestamp: string) =>
  database
    .prepare(
      `DELETE FROM bookmark_idempotency_results WHERE operation_id IN (
         SELECT operation_id FROM bookmark_idempotency_results
          WHERE expires_at <= ? ORDER BY expires_at LIMIT 200
       )`,
    )
    .bind(timestamp);

export const isAssertionFailure = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('CHECK constraint failed: valid = 1');
};
