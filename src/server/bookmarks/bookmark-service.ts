import * as v from 'valibot';

import {
  BOOKMARK_SNAPSHOT_WIRE_FORMAT_VERSION,
  bookmarkSnapshotSchema,
  type BookmarkSnapshot,
} from '../../shared/bookmarks/contracts';

export type BookmarkService = {
  getSnapshot(): Promise<BookmarkSnapshot>;
};

type SnapshotRow = Record<string, string | number | null>;

const rowsAt = (results: D1Result<SnapshotRow>[], index: number): SnapshotRow[] =>
  results[index]?.results ?? [];

export const createBookmarkService = (database: D1Database): BookmarkService => ({
  async getSnapshot() {
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
  },
});
