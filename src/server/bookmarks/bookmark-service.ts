import * as v from 'valibot';

import {
  BOOKMARK_SNAPSHOT_WIRE_FORMAT_VERSION,
  bookmarkTitleFor,
  bookmarkCommandResultSchema,
  bookmarkCommandSchema,
  bookmarkSnapshotSchema,
  normalizeBookmarkTags,
  type Bookmark,
  type BookmarkCommand,
  type BookmarkCommandResult,
  type BookmarkFolder,
  type BookmarkSequence,
  type BookmarkSnapshot,
} from '../../shared/bookmarks/contracts';

export type BookmarkService = {
  getSnapshot(): Promise<BookmarkSnapshot>;
  executeCommand(command: BookmarkCommand): Promise<BookmarkCommandResult>;
};

type SnapshotRow = Record<string, string | number | null>;
type FolderRow = BookmarkFolder & { parentId: string | null };
type BookmarkRow = Bookmark;
type SequenceRow = { folderId: string; folderVersion: number; bookmarkVersion: number };
type RevisionRow = { revision: number };
type IdempotencyRow = { resultJson: string };

type BookmarkServiceOptions = {
  now?: () => Date;
  randomUUID?: () => string;
};

const rowsAt = (results: D1Result<SnapshotRow>[], index: number): SnapshotRow[] =>
  results[index]?.results ?? [];

const readSnapshot = async (database: D1Database): Promise<BookmarkSnapshot> => {
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
};

const folderStatement = (database: D1Database, folderId: string) =>
  database
    .prepare(
      `SELECT id, name, parent_id AS parentId, rank, created_at AS createdAt,
              modified_at AS modifiedAt, version
         FROM bookmark_folders
        WHERE id = ? AND trashed_at IS NULL AND trash_root_id IS NULL`,
    )
    .bind(folderId);

const bookmarkStatement = (database: D1Database, bookmarkId: string) =>
  database
    .prepare(
      `SELECT id, folder_id AS folderId, url, title, note, rank,
              created_at AS createdAt, modified_at AS modifiedAt, version
         FROM bookmarks
        WHERE id = ? AND trashed_at IS NULL AND trash_root_id IS NULL`,
    )
    .bind(bookmarkId);

const sequenceStatement = (database: D1Database, folderId: string) =>
  database
    .prepare(
      `SELECT folder_id AS folderId,
              MAX(CASE WHEN kind = 'folders' THEN version END) AS folderVersion,
              MAX(CASE WHEN kind = 'bookmarks' THEN version END) AS bookmarkVersion
         FROM bookmark_sequences
        WHERE folder_id = ?
        GROUP BY folder_id
       HAVING COUNT(*) = 2`,
    )
    .bind(folderId);

const nextRank = async (
  database: D1Database,
  table: 'bookmark_folders' | 'bookmarks',
  parentColumn: 'parent_id' | 'folder_id',
  parentId: string,
): Promise<string> => {
  const row = await database
    .prepare(`SELECT MAX(rank) AS rank FROM ${table} WHERE ${parentColumn} = ?`)
    .bind(parentId)
    .first<{ rank: string | null }>();
  return row?.rank ? `${row.rank}z` : 'a';
};

const resultExpiry = (now: Date): string =>
  new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString();

export const createBookmarkService = (
  database: D1Database,
  options: BookmarkServiceOptions = {},
): BookmarkService => {
  const now = options.now ?? (() => new Date());
  const randomUUID = options.randomUUID ?? (() => crypto.randomUUID());

  const conflict = async (
    command: BookmarkCommand,
    code: Extract<BookmarkCommandResult, { status: 'conflict' }>['code'],
    filter?: { folderId?: string; bookmarkId?: string; sequenceFolderId?: string },
  ): Promise<BookmarkCommandResult> => {
    const snapshot = await readSnapshot(database);
    return v.parse(bookmarkCommandResultSchema, {
      status: 'conflict',
      operationId: command.operationId,
      code,
      revision: snapshot.revision,
      folders: filter?.folderId
        ? snapshot.folders.filter((folder) => folder.id === filter.folderId)
        : [],
      bookmarks: filter?.bookmarkId
        ? snapshot.bookmarks.filter((bookmark) => bookmark.id === filter.bookmarkId)
        : [],
      tags: filter?.bookmarkId
        ? snapshot.tags.filter((tag) => tag.bookmarkId === filter.bookmarkId)
        : [],
      sequences: filter?.sequenceFolderId
        ? snapshot.sequences.filter((sequence) => sequence.folderId === filter.sequenceFolderId)
        : [],
    });
  };

  const storeResultStatements = (
    command: BookmarkCommand,
    result: BookmarkCommandResult,
    timestamp: string,
    expiresAt: string,
  ): D1PreparedStatement[] => [
    database
      .prepare(
        `INSERT INTO bookmark_idempotency_results
          (operation_id, command_type, result_json, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(command.operationId, command.type, JSON.stringify(result), timestamp, expiresAt),
    database
      .prepare('DELETE FROM bookmark_command_assertions WHERE operation_id = ?')
      .bind(command.operationId),
  ];

  const executeCommand = async (input: BookmarkCommand): Promise<BookmarkCommandResult> => {
    const command = v.parse(bookmarkCommandSchema, input);
    const settled = await database
      .prepare(
        `SELECT result_json AS resultJson
           FROM bookmark_idempotency_results
          WHERE operation_id = ?`,
      )
      .bind(command.operationId)
      .first<IdempotencyRow>();
    if (settled) return v.parse(bookmarkCommandResultSchema, JSON.parse(settled.resultJson));

    const revisionRow = await database
      .prepare("SELECT revision FROM bookmark_domain_state WHERE name = 'bookmarks'")
      .first<RevisionRow>();
    const revision = revisionRow?.revision ?? 0;
    const timestamp = now().toISOString();
    const expiresAt = resultExpiry(new Date(timestamp));

    if (command.type === 'createFolder') {
      const [parent, sequence, duplicate] = await Promise.all([
        folderStatement(database, command.parentId).first<FolderRow>(),
        sequenceStatement(database, command.parentId).first<SequenceRow>(),
        database
          .prepare(
            `SELECT id FROM bookmark_folders
              WHERE parent_id = ? AND name = ?
                AND trashed_at IS NULL AND trash_root_id IS NULL`,
          )
          .bind(command.parentId, command.name)
          .first<{ id: string }>(),
      ]);
      if (!parent || !sequence) return conflict(command, 'missing_entity');
      if (sequence.folderVersion !== command.expectedFolderSequenceVersion) {
        return conflict(command, 'stale_sequence', { sequenceFolderId: command.parentId });
      }
      if (duplicate) return conflict(command, 'name_conflict', { folderId: duplicate.id });

      const folder: BookmarkFolder = {
        id: randomUUID(),
        name: command.name,
        parentId: command.parentId,
        rank: await nextRank(database, 'bookmark_folders', 'parent_id', command.parentId),
        createdAt: timestamp,
        modifiedAt: timestamp,
        version: 1,
      };
      const updatedSequence: BookmarkSequence = {
        folderId: command.parentId,
        folderVersion: sequence.folderVersion + 1,
        bookmarkVersion: sequence.bookmarkVersion,
      };
      const result = v.parse(bookmarkCommandResultSchema, {
        status: 'acknowledged',
        operationId: command.operationId,
        revision: revision + 1,
        folders: [folder],
        bookmarks: [],
        tags: [],
        sequences: [updatedSequence],
      });
      await database.batch([
        database
          .prepare(
            `INSERT INTO bookmark_command_assertions (operation_id, valid)
             SELECT ?, CASE WHEN
               (SELECT revision FROM bookmark_domain_state WHERE name = 'bookmarks') = ?
               AND (SELECT version FROM bookmark_sequences WHERE folder_id = ? AND kind = 'folders') = ?
               AND NOT EXISTS (
                 SELECT 1 FROM bookmark_folders
                  WHERE parent_id = ? AND name = ?
                    AND trashed_at IS NULL AND trash_root_id IS NULL
               )
             THEN 1 ELSE 0 END`,
          )
          .bind(
            command.operationId,
            revision,
            command.parentId,
            command.expectedFolderSequenceVersion,
            command.parentId,
            command.name,
          ),
        database
          .prepare(
            `INSERT INTO bookmark_folders
              (id, name, parent_id, rank, created_at, modified_at, version)
             VALUES (?, ?, ?, ?, ?, ?, 1)`,
          )
          .bind(
            folder.id,
            folder.name,
            folder.parentId,
            folder.rank,
            folder.createdAt,
            folder.modifiedAt,
          ),
        database
          .prepare('INSERT INTO bookmark_sequences (folder_id, kind, version) VALUES (?, ?, 1)')
          .bind(folder.id, 'folders'),
        database
          .prepare('INSERT INTO bookmark_sequences (folder_id, kind, version) VALUES (?, ?, 1)')
          .bind(folder.id, 'bookmarks'),
        database
          .prepare(
            "UPDATE bookmark_sequences SET version = version + 1 WHERE folder_id = ? AND kind = 'folders'",
          )
          .bind(command.parentId),
        database.prepare(
          "UPDATE bookmark_domain_state SET revision = revision + 1 WHERE name = 'bookmarks'",
        ),
        ...storeResultStatements(command, result, timestamp, expiresAt),
      ]);
      return result;
    }

    if (command.type === 'editFolder') {
      const folder = await folderStatement(database, command.folderId).first<FolderRow>();
      if (!folder) return conflict(command, 'missing_entity');
      if (folder.version !== command.folderVersion) {
        return conflict(command, 'stale_entity', { folderId: command.folderId });
      }
      const duplicate = await database
        .prepare(
          `SELECT id FROM bookmark_folders
            WHERE parent_id = ? AND name = ? AND id != ?
              AND trashed_at IS NULL AND trash_root_id IS NULL`,
        )
        .bind(folder.parentId, command.name, command.folderId)
        .first<{ id: string }>();
      if (duplicate) return conflict(command, 'name_conflict', { folderId: duplicate.id });

      const updated: BookmarkFolder = {
        ...folder,
        name: command.name,
        modifiedAt: timestamp,
        version: folder.version + 1,
      };
      const result = v.parse(bookmarkCommandResultSchema, {
        status: 'acknowledged',
        operationId: command.operationId,
        revision: revision + 1,
        folders: [updated],
        bookmarks: [],
        tags: [],
        sequences: [],
      });
      await database.batch([
        database
          .prepare(
            `INSERT INTO bookmark_command_assertions (operation_id, valid)
             SELECT ?, CASE WHEN
               (SELECT revision FROM bookmark_domain_state WHERE name = 'bookmarks') = ?
               AND (SELECT version FROM bookmark_folders WHERE id = ?) = ?
               AND NOT EXISTS (
                 SELECT 1 FROM bookmark_folders
                  WHERE parent_id IS ? AND name = ? AND id != ?
                    AND trashed_at IS NULL AND trash_root_id IS NULL
               )
             THEN 1 ELSE 0 END`,
          )
          .bind(
            command.operationId,
            revision,
            command.folderId,
            command.folderVersion,
            folder.parentId,
            command.name,
            command.folderId,
          ),
        database
          .prepare(
            'UPDATE bookmark_folders SET name = ?, modified_at = ?, version = version + 1 WHERE id = ?',
          )
          .bind(command.name, timestamp, command.folderId),
        database.prepare(
          "UPDATE bookmark_domain_state SET revision = revision + 1 WHERE name = 'bookmarks'",
        ),
        ...storeResultStatements(command, result, timestamp, expiresAt),
      ]);
      return result;
    }

    if (command.type === 'createBookmark') {
      const [folder, sequence] = await Promise.all([
        folderStatement(database, command.folderId).first<FolderRow>(),
        sequenceStatement(database, command.folderId).first<SequenceRow>(),
      ]);
      if (!folder || !sequence) return conflict(command, 'missing_entity');
      if (sequence.bookmarkVersion !== command.expectedBookmarkSequenceVersion) {
        return conflict(command, 'stale_sequence', { sequenceFolderId: command.folderId });
      }
      const tags = normalizeBookmarkTags(command.tags);
      const bookmark: Bookmark = {
        id: randomUUID(),
        folderId: command.folderId,
        url: command.url,
        title: bookmarkTitleFor(command.url, command.title),
        note: command.note,
        rank: await nextRank(database, 'bookmarks', 'folder_id', command.folderId),
        createdAt: timestamp,
        modifiedAt: timestamp,
        version: 1,
      };
      const updatedSequence: BookmarkSequence = {
        folderId: command.folderId,
        folderVersion: sequence.folderVersion,
        bookmarkVersion: sequence.bookmarkVersion + 1,
      };
      const result = v.parse(bookmarkCommandResultSchema, {
        status: 'acknowledged',
        operationId: command.operationId,
        revision: revision + 1,
        folders: [],
        bookmarks: [bookmark],
        tags: tags.map((value) => ({ bookmarkId: bookmark.id, value })),
        sequences: [updatedSequence],
      });
      await database.batch([
        database
          .prepare(
            `INSERT INTO bookmark_command_assertions (operation_id, valid)
             SELECT ?, CASE WHEN
               (SELECT revision FROM bookmark_domain_state WHERE name = 'bookmarks') = ?
               AND (SELECT version FROM bookmark_sequences WHERE folder_id = ? AND kind = 'bookmarks') = ?
             THEN 1 ELSE 0 END`,
          )
          .bind(
            command.operationId,
            revision,
            command.folderId,
            command.expectedBookmarkSequenceVersion,
          ),
        database
          .prepare(
            `INSERT INTO bookmarks
              (id, folder_id, url, title, note, rank, created_at, modified_at, version)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          )
          .bind(
            bookmark.id,
            bookmark.folderId,
            bookmark.url,
            bookmark.title,
            bookmark.note,
            bookmark.rank,
            bookmark.createdAt,
            bookmark.modifiedAt,
          ),
        ...tags.map((value) =>
          database
            .prepare(
              'INSERT INTO bookmark_tags (bookmark_id, display_value, lowercase_key) VALUES (?, ?, ?)',
            )
            .bind(bookmark.id, value, value.toLocaleLowerCase()),
        ),
        database
          .prepare(
            "UPDATE bookmark_sequences SET version = version + 1 WHERE folder_id = ? AND kind = 'bookmarks'",
          )
          .bind(command.folderId),
        database.prepare(
          "UPDATE bookmark_domain_state SET revision = revision + 1 WHERE name = 'bookmarks'",
        ),
        ...storeResultStatements(command, result, timestamp, expiresAt),
      ]);
      return result;
    }

    const bookmark = await bookmarkStatement(database, command.bookmarkId).first<BookmarkRow>();
    if (!bookmark) return conflict(command, 'missing_entity');
    if (bookmark.version !== command.bookmarkVersion) {
      return conflict(command, 'stale_entity', { bookmarkId: command.bookmarkId });
    }
    const tags = normalizeBookmarkTags(command.tags);
    const updated: Bookmark = {
      ...bookmark,
      url: command.url,
      title: command.title,
      note: command.note,
      modifiedAt: timestamp,
      version: bookmark.version + 1,
    };
    const result = v.parse(bookmarkCommandResultSchema, {
      status: 'acknowledged',
      operationId: command.operationId,
      revision: revision + 1,
      folders: [],
      bookmarks: [updated],
      tags: tags.map((value) => ({ bookmarkId: bookmark.id, value })),
      sequences: [],
    });
    await database.batch([
      database
        .prepare(
          `INSERT INTO bookmark_command_assertions (operation_id, valid)
           SELECT ?, CASE WHEN
             (SELECT revision FROM bookmark_domain_state WHERE name = 'bookmarks') = ?
             AND (SELECT version FROM bookmarks WHERE id = ?) = ?
           THEN 1 ELSE 0 END`,
        )
        .bind(command.operationId, revision, command.bookmarkId, command.bookmarkVersion),
      database
        .prepare(
          `UPDATE bookmarks
              SET url = ?, title = ?, note = ?, modified_at = ?, version = version + 1
            WHERE id = ?`,
        )
        .bind(command.url, command.title, command.note, timestamp, command.bookmarkId),
      database.prepare('DELETE FROM bookmark_tags WHERE bookmark_id = ?').bind(command.bookmarkId),
      ...tags.map((value) =>
        database
          .prepare(
            'INSERT INTO bookmark_tags (bookmark_id, display_value, lowercase_key) VALUES (?, ?, ?)',
          )
          .bind(command.bookmarkId, value, value.toLocaleLowerCase()),
      ),
      database.prepare(
        "UPDATE bookmark_domain_state SET revision = revision + 1 WHERE name = 'bookmarks'",
      ),
      ...storeResultStatements(command, result, timestamp, expiresAt),
    ]);
    return result;
  };

  return {
    getSnapshot: () => readSnapshot(database),
    executeCommand,
  };
};
