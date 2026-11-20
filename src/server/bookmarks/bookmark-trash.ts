import * as v from 'valibot';
import {
  SYSTEM_ROOT_FOLDER_ID,
  bookmarkCommandResultSchema,
  type BookmarkCommand,
  type BookmarkCommandResult,
  type BookmarkTag,
} from '../../shared/bookmarks/contracts';
import type { BookmarkDatabase, BookmarkDatabaseStatement } from './bookmark-database';
import {
  FOLDER_COLUMNS,
  BOOKMARK_COLUMNS,
  bookmarkStatement,
  bookmarkTagsStatement,
  chunkIds,
  exceedsFolderDepth,
  folderStatement,
  folderSubtreeHeight,
  isAssertionFailure,
  placeholders,
  pruneExpiredResults,
  readRows,
  revisionStatement,
  sequenceStatement,
  type BookmarkRow,
  type FolderRow,
  type RevisionRow,
  type SequenceRow,
} from './bookmark-queries';
import { nextRank, toRank } from './bookmark-ranking';

type TrashRootKind = Extract<BookmarkCommand, { type: 'restoreTrash' }>['rootKind'];

const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

const trashRootStorage = (kind: TrashRootKind) =>
  kind === 'folder'
    ? {
        table: 'bookmark_folders' as const,
        parentColumn: 'parent_id' as const,
        originalParentColumn: 'original_parent_id' as const,
        sequenceKind: 'folders' as const,
      }
    : {
        table: 'bookmarks' as const,
        parentColumn: 'folder_id' as const,
        originalParentColumn: 'original_folder_id' as const,
        sequenceKind: 'bookmarks' as const,
      };

type TrashDeletionPlan = { folderIds: string[]; bookmarkIds: string[] };
type TrashFolderRow = { id: string; parentId: string | null };

const trashRootsStatement = (database: BookmarkDatabase, table: 'bookmark_folders' | 'bookmarks') =>
  database.prepare(`SELECT id FROM ${table} WHERE trashed_at IS NOT NULL`);

const idsCte = (ids: string[]) => `WITH ids(id) AS (VALUES ${ids.map(() => '(?)').join(', ')})`;

const trashDeletionPlan = async (
  database: BookmarkDatabase,
  folderRootIds: string[],
  bookmarkRootIds: string[],
): Promise<TrashDeletionPlan> => {
  const chunks = chunkIds(folderRootIds);
  const [folders, bookmarks] = await Promise.all([
    readRows<TrashFolderRow>(
      database,
      chunks.map((ids) =>
        database
          .prepare(
            `${idsCte(ids)}
             SELECT id, parent_id AS parentId FROM bookmark_folders
              WHERE id IN (SELECT id FROM ids) OR trash_root_id IN (SELECT id FROM ids)`,
          )
          .bind(...ids),
      ),
    ),
    readRows<{ id: string }>(
      database,
      chunks.map((ids) =>
        database
          .prepare(`SELECT id FROM bookmarks WHERE trash_root_id IN (${placeholders(ids)})`)
          .bind(...ids),
      ),
    ),
  ]);
  const folderRows = new Map(folders.map((folder) => [folder.id, folder]));
  const depth = (id: string): number => {
    const parentId = folderRows.get(id)?.parentId;
    return parentId && folderRows.has(parentId) ? depth(parentId) + 1 : 0;
  };
  const depths = new Map([...folderRows.keys()].map((id) => [id, depth(id)]));
  const folderIds = [...depths.keys()].sort(
    (left, right) => depths.get(right)! - depths.get(left)! || left.localeCompare(right),
  );
  const bookmarkIds = [
    ...new Set([...bookmarkRootIds, ...bookmarks.map((bookmark) => bookmark.id)]),
  ];
  return { folderIds, bookmarkIds: bookmarkIds.sort() };
};

const executeTrashDeletionStatements = (
  database: BookmarkDatabase,
  plan: TrashDeletionPlan,
): BookmarkDatabaseStatement[] => {
  const folderChunks = chunkIds(plan.folderIds);
  return [
    // Detach separately trashed roots before removing the Folders they reference.
    ...folderChunks.flatMap((ids) =>
      (['folder', 'bookmark'] as const).map((kind) => {
        const { table, parentColumn, originalParentColumn } = trashRootStorage(kind);
        return database
          .prepare(
            `${idsCte(ids)}
             UPDATE ${table} SET ${parentColumn} = ?, ${originalParentColumn} = ?
              WHERE trashed_at IS NOT NULL
                AND (${parentColumn} IN (SELECT id FROM ids)
                     OR ${originalParentColumn} IN (SELECT id FROM ids))`,
          )
          .bind(...ids, SYSTEM_ROOT_FOLDER_ID, SYSTEM_ROOT_FOLDER_ID);
      }),
    ),
    ...chunkIds(plan.bookmarkIds).map((ids) =>
      database.prepare(`DELETE FROM bookmarks WHERE id IN (${placeholders(ids)})`).bind(...ids),
    ),
    ...folderChunks.map((ids) =>
      database
        .prepare(`DELETE FROM bookmark_folders WHERE id IN (${placeholders(ids)})`)
        .bind(...ids),
    ),
  ];
};

type TrashCommandContext = {
  database: BookmarkDatabase;
  revision: number;
  timestamp: string;
  beforeCommandBatch: () => Promise<void>;
  conflict: (
    command: BookmarkCommand,
    code: Extract<BookmarkCommandResult, { status: 'conflict' }>['code'],
    filter?: { folderId?: string; bookmarkId?: string; sequenceFolderId?: string },
  ) => Promise<BookmarkCommandResult>;
  storeResult: (
    command: BookmarkCommand,
    result: BookmarkCommandResult,
  ) => BookmarkDatabaseStatement[];
};

export const createTrashCommands = ({
  database,
  revision,
  timestamp,
  beforeCommandBatch,
  conflict,
  storeResult,
}: TrashCommandContext) => {
  const trashBookmark = async (
    trashCommand: Extract<BookmarkCommand, { type: 'trashBookmark' }>,
  ): Promise<BookmarkCommandResult> => {
    const [bookmark, sequence] = await Promise.all([
      bookmarkStatement(database, trashCommand.bookmarkId).first<BookmarkRow>(),
      sequenceStatement(database, trashCommand.folderId).first<SequenceRow>(),
    ]);
    if (!bookmark || !sequence || bookmark.folderId !== trashCommand.folderId) {
      return conflict(trashCommand, 'missing_entity');
    }
    if (bookmark.version !== trashCommand.bookmarkVersion) {
      return conflict(trashCommand, 'stale_entity', { bookmarkId: bookmark.id });
    }
    if (sequence.bookmarkVersion !== trashCommand.expectedBookmarkSequenceVersion) {
      return conflict(trashCommand, 'stale_sequence', {
        sequenceFolderId: trashCommand.folderId,
      });
    }
    const result = v.parse(bookmarkCommandResultSchema, {
      status: 'acknowledged',
      operationId: trashCommand.operationId,
      revision: revision + 1,
      folders: [],
      bookmarks: [],
      tags: [],
      sequences: [{ ...sequence, bookmarkVersion: sequence.bookmarkVersion + 1 }],
      deletedBookmarkIds: [bookmark.id],
    });
    await beforeCommandBatch();
    await database.batch([
      database
        .prepare(
          `INSERT INTO bookmark_command_assertions (operation_id, valid)
           SELECT ?, CASE WHEN
             (SELECT revision FROM bookmark_domain_state WHERE name = 'bookmarks') = ?
             AND (SELECT version FROM bookmarks
                   WHERE id = ? AND folder_id = ? AND trashed_at IS NULL AND trash_root_id IS NULL) = ?
             AND (SELECT version FROM bookmark_sequences
                   WHERE folder_id = ? AND kind = 'bookmarks') = ?
           THEN 1 ELSE 0 END`,
        )
        .bind(
          trashCommand.operationId,
          revision,
          bookmark.id,
          trashCommand.folderId,
          trashCommand.bookmarkVersion,
          trashCommand.folderId,
          trashCommand.expectedBookmarkSequenceVersion,
        ),
      database
        .prepare(
          `UPDATE bookmarks
              SET trashed_at = ?, trash_root_id = NULL, original_folder_id = folder_id,
                  original_rank = rank, modified_at = ?, version = version + 1
            WHERE id = ?`,
        )
        .bind(timestamp, timestamp, bookmark.id),
      database
        .prepare(
          "UPDATE bookmark_sequences SET version = version + 1 WHERE folder_id = ? AND kind = 'bookmarks'",
        )
        .bind(trashCommand.folderId),
      database.prepare(
        "UPDATE bookmark_domain_state SET revision = revision + 1 WHERE name = 'bookmarks'",
      ),
      ...storeResult(trashCommand, result),
    ]);
    return result;
  };

  const trashFolder = async (
    trashCommand: Extract<BookmarkCommand, { type: 'trashFolder' }>,
  ): Promise<BookmarkCommandResult> => {
    const [folder, sequence] = await Promise.all([
      folderStatement(database, trashCommand.folderId).first<FolderRow>(),
      sequenceStatement(database, trashCommand.parentId).first<SequenceRow>(),
    ]);
    if (!folder || !sequence || folder.parentId !== trashCommand.parentId) {
      return conflict(trashCommand, 'missing_entity');
    }
    if (folder.version !== trashCommand.folderVersion) {
      return conflict(trashCommand, 'stale_entity', { folderId: folder.id });
    }
    if (sequence.folderVersion !== trashCommand.expectedFolderSequenceVersion) {
      return conflict(trashCommand, 'stale_sequence', {
        sequenceFolderId: trashCommand.parentId,
      });
    }
    const subtree = await database
      .prepare(
        `WITH RECURSIVE subtree(id) AS (
           SELECT id FROM bookmark_folders WHERE id = ?
           UNION ALL
           SELECT child.id FROM bookmark_folders child JOIN subtree parent ON child.parent_id = parent.id
            WHERE child.trashed_at IS NULL AND child.trash_root_id IS NULL
         ) SELECT id FROM subtree ORDER BY id`,
      )
      .bind(folder.id)
      .all<{ id: string }>();
    const folderIds = subtree.results.map((row) => row.id);
    const nestedBookmarks = await database
      .prepare(
        `WITH RECURSIVE subtree(id) AS (
           SELECT id FROM bookmark_folders WHERE id = ?
           UNION ALL
           SELECT child.id FROM bookmark_folders child JOIN subtree parent ON child.parent_id = parent.id
            WHERE child.trashed_at IS NULL AND child.trash_root_id IS NULL
         ) SELECT bookmarks.id FROM bookmarks JOIN subtree ON subtree.id = bookmarks.folder_id
            WHERE bookmarks.trashed_at IS NULL AND bookmarks.trash_root_id IS NULL ORDER BY bookmarks.id`,
      )
      .bind(folder.id)
      .all<{ id: string }>();
    const bookmarkIds = nestedBookmarks.results.map((row) => row.id);
    const result = v.parse(bookmarkCommandResultSchema, {
      status: 'acknowledged',
      operationId: trashCommand.operationId,
      revision: revision + 1,
      folders: [],
      bookmarks: [],
      tags: [],
      sequences: [{ ...sequence, folderVersion: sequence.folderVersion + 1 }],
      deletedFolderIds: folderIds,
      deletedBookmarkIds: bookmarkIds,
    });
    await beforeCommandBatch();
    await database.batch([
      database
        .prepare(
          `INSERT INTO bookmark_command_assertions (operation_id, valid)
           SELECT ?, CASE WHEN
             (SELECT revision FROM bookmark_domain_state WHERE name = 'bookmarks') = ?
             AND (SELECT version FROM bookmark_folders
                   WHERE id = ? AND parent_id = ? AND trashed_at IS NULL AND trash_root_id IS NULL) = ?
             AND (SELECT version FROM bookmark_sequences WHERE folder_id = ? AND kind = 'folders') = ?
           THEN 1 ELSE 0 END`,
        )
        .bind(
          trashCommand.operationId,
          revision,
          folder.id,
          trashCommand.parentId,
          trashCommand.folderVersion,
          trashCommand.parentId,
          trashCommand.expectedFolderSequenceVersion,
        ),
      database
        .prepare(
          `UPDATE bookmark_folders
              SET trashed_at = ?, trash_root_id = NULL, original_parent_id = parent_id,
                  original_rank = rank, modified_at = ?, version = version + 1
            WHERE id = ?`,
        )
        .bind(timestamp, timestamp, folder.id),
      database
        .prepare(
          `WITH RECURSIVE subtree(id) AS (
             SELECT id FROM bookmark_folders WHERE id = ?
             UNION ALL SELECT child.id FROM bookmark_folders child JOIN subtree parent ON child.parent_id = parent.id
               WHERE child.trashed_at IS NULL AND child.trash_root_id IS NULL
           ) UPDATE bookmark_folders SET trash_root_id = ? WHERE id IN (SELECT id FROM subtree) AND id != ?`,
        )
        .bind(folder.id, folder.id, folder.id),
      database
        .prepare(
          `WITH RECURSIVE subtree(id) AS (
             SELECT id FROM bookmark_folders WHERE id = ?
             UNION ALL SELECT child.id FROM bookmark_folders child JOIN subtree parent ON child.parent_id = parent.id
               WHERE (child.trashed_at IS NULL AND child.trash_root_id IS NULL)
                  OR child.trash_root_id = ?
           ) UPDATE bookmarks SET trash_root_id = ? WHERE folder_id IN (SELECT id FROM subtree)
               AND trashed_at IS NULL AND trash_root_id IS NULL`,
        )
        .bind(folder.id, folder.id, folder.id),
      database
        .prepare(
          "UPDATE bookmark_sequences SET version = version + 1 WHERE folder_id = ? AND kind = 'folders'",
        )
        .bind(trashCommand.parentId),
      database.prepare(
        "UPDATE bookmark_domain_state SET revision = revision + 1 WHERE name = 'bookmarks'",
      ),
      ...storeResult(trashCommand, result),
    ]);
    return result;
  };

  const restoreTrash = async (
    restoreCommand: Extract<BookmarkCommand, { type: 'restoreTrash' }>,
  ): Promise<BookmarkCommandResult> => {
    const storage = trashRootStorage(restoreCommand.rootKind);
    const table = storage.table;
    const root = await database
      .prepare(
        restoreCommand.rootKind === 'folder'
          ? `SELECT id, name, version, original_parent_id AS originalParentId,
                    original_rank AS originalRank FROM bookmark_folders
               WHERE id = ? AND trashed_at IS NOT NULL AND trash_root_id IS NULL`
          : `SELECT id, version, original_folder_id AS originalParentId,
                    original_rank AS originalRank FROM bookmarks
               WHERE id = ? AND trashed_at IS NOT NULL AND trash_root_id IS NULL`,
      )
      .bind(restoreCommand.rootId)
      .first<{
        id: string;
        name?: string;
        version: number;
        originalParentId: string;
        originalRank: string;
      }>();
    if (!root) return conflict(restoreCommand, 'missing_entity');
    if (root.version !== restoreCommand.rootVersion) {
      return conflict(restoreCommand, 'stale_entity');
    }
    const originalParent = await folderStatement(
      database,
      root.originalParentId,
    ).first<FolderRow>();
    const destinationId = originalParent ? root.originalParentId : SYSTEM_ROOT_FOLDER_ID;
    const sequence = await sequenceStatement(database, destinationId).first<SequenceRow>();
    if (!sequence) return conflict(restoreCommand, 'missing_entity');
    const sequenceVersion =
      storage.sequenceKind === 'folders' ? sequence.folderVersion : sequence.bookmarkVersion;
    if (sequenceVersion !== restoreCommand.expectedDestinationSequenceVersion) {
      return conflict(restoreCommand, 'stale_sequence', { sequenceFolderId: destinationId });
    }
    if (restoreCommand.rootKind === 'folder') {
      const duplicate = await database
        .prepare(
          `SELECT id FROM bookmark_folders WHERE parent_id = ? AND name = ? AND id != ?
            AND trashed_at IS NULL AND trash_root_id IS NULL`,
        )
        .bind(destinationId, root.name, root.id)
        .first<{ id: string }>();
      if (duplicate) return conflict(restoreCommand, 'name_conflict', { folderId: duplicate.id });
      if (
        await exceedsFolderDepth(
          database,
          destinationId,
          folderSubtreeHeight(database, root.id, root.id),
        )
      ) {
        return conflict(restoreCommand, 'folder_depth', { folderId: root.id });
      }
    }
    const { parentColumn, sequenceKind: kind, originalParentColumn } = storage;
    const rankConflict = await database
      .prepare(
        `SELECT id FROM ${table} WHERE ${parentColumn} = ? AND rank = ? AND id != ?
          AND trashed_at IS NULL AND trash_root_id IS NULL`,
      )
      .bind(destinationId, root.originalRank, root.id)
      .first<{ id: string }>();
    const rank = rankConflict
      ? await nextRank(database, table, parentColumn, destinationId)
      : toRank(root.originalRank);
    const isFolder = restoreCommand.rootKind === 'folder';
    const bookmarkScope = isFolder ? 'trash_root_id = ?' : 'id = ?';
    const [restoredFolders, restoredBookmarks, tags, restoredSequences] = await Promise.all([
      isFolder
        ? database
            .prepare(
              `SELECT ${FOLDER_COLUMNS} FROM bookmark_folders
                WHERE id = ? OR trash_root_id = ? ORDER BY parent_id, rank, id`,
            )
            .bind(root.id, root.id)
            .all<FolderRow>()
            .then((rows) => rows.results)
        : [],
      database
        .prepare(
          `SELECT ${BOOKMARK_COLUMNS} FROM bookmarks
            WHERE ${bookmarkScope} ORDER BY folder_id, rank, id`,
        )
        .bind(root.id)
        .all<BookmarkRow>()
        .then((rows) => rows.results),
      bookmarkTagsStatement(
        database,
        `bookmark_id IN (SELECT id FROM bookmarks WHERE ${bookmarkScope})`,
        [root.id],
      )
        .all<BookmarkTag>()
        .then((rows) => rows.results),
      isFolder
        ? database
            .prepare(
              `SELECT folder.id AS folderId,
                      MAX(CASE WHEN sequence.kind = 'folders' THEN sequence.version END) AS folderVersion,
                      MAX(CASE WHEN sequence.kind = 'bookmarks' THEN sequence.version END) AS bookmarkVersion
                 FROM bookmark_folders folder
                 LEFT JOIN bookmark_sequences sequence ON sequence.folder_id = folder.id
                WHERE folder.id = ? OR folder.trash_root_id = ?
                GROUP BY folder.id
                ORDER BY folder.id`,
            )
            .bind(root.id, root.id)
            .all<SequenceRow>()
            .then((rows) => rows.results)
        : [],
    ]);
    const restoreRoot = <Item extends { modifiedAt: string; version: number }>(item: Item) => ({
      ...item,
      rank,
      modifiedAt: timestamp,
      version: item.version + 1,
    });
    const result = v.parse(bookmarkCommandResultSchema, {
      status: 'acknowledged',
      operationId: restoreCommand.operationId,
      revision: revision + 1,
      folders: restoredFolders.map((folder) =>
        folder.id === root.id ? { ...restoreRoot(folder), parentId: destinationId } : folder,
      ),
      bookmarks: isFolder
        ? restoredBookmarks
        : restoredBookmarks.map((bookmark) => ({
            ...restoreRoot(bookmark),
            folderId: destinationId,
          })),
      tags,
      sequences: [
        {
          ...sequence,
          ...(kind === 'folders'
            ? { folderVersion: sequence.folderVersion + 1 }
            : { bookmarkVersion: sequence.bookmarkVersion + 1 }),
        },
        ...restoredSequences,
      ],
    });
    await beforeCommandBatch();
    await database.batch([
      database
        .prepare(
          `INSERT INTO bookmark_command_assertions (operation_id, valid)
           SELECT ?, CASE WHEN
             (SELECT revision FROM bookmark_domain_state WHERE name = 'bookmarks') = ?
             AND (SELECT version FROM ${table} WHERE id = ? AND trashed_at IS NOT NULL) = ?
             AND (SELECT version FROM bookmark_sequences WHERE folder_id = ? AND kind = ?) = ?
           THEN 1 ELSE 0 END`,
        )
        .bind(
          restoreCommand.operationId,
          revision,
          root.id,
          root.version,
          destinationId,
          kind,
          restoreCommand.expectedDestinationSequenceVersion,
        ),
      database
        .prepare(
          `UPDATE ${table} SET ${parentColumn} = ?, rank = ?, trashed_at = NULL,
                  trash_root_id = NULL, modified_at = ?, version = version + 1,
                  ${originalParentColumn} = NULL,
                  original_rank = NULL WHERE id = ?`,
        )
        .bind(destinationId, rank, timestamp, root.id),
      ...(restoreCommand.rootKind === 'folder'
        ? [
            database
              .prepare('UPDATE bookmark_folders SET trash_root_id = NULL WHERE trash_root_id = ?')
              .bind(root.id),
            database
              .prepare('UPDATE bookmarks SET trash_root_id = NULL WHERE trash_root_id = ?')
              .bind(root.id),
          ]
        : []),
      database
        .prepare(
          'UPDATE bookmark_sequences SET version = version + 1 WHERE folder_id = ? AND kind = ?',
        )
        .bind(destinationId, kind),
      database.prepare(
        "UPDATE bookmark_domain_state SET revision = revision + 1 WHERE name = 'bookmarks'",
      ),
      ...storeResult(restoreCommand, result),
    ]);
    return result;
  };

  const purgeTrash = async (
    purgeCommand: Extract<BookmarkCommand, { type: 'purgeTrash' }>,
  ): Promise<BookmarkCommandResult> => {
    const { table } = trashRootStorage(purgeCommand.rootKind);
    const root = await database
      .prepare(`SELECT id, version FROM ${table} WHERE id = ? AND trashed_at IS NOT NULL`)
      .bind(purgeCommand.rootId)
      .first<{ id: string; version: number }>();
    if (!root) return conflict(purgeCommand, 'missing_entity');
    if (root.version !== purgeCommand.rootVersion) return conflict(purgeCommand, 'stale_entity');
    const plan = await trashDeletionPlan(
      database,
      purgeCommand.rootKind === 'folder' ? [root.id] : [],
      purgeCommand.rootKind === 'bookmark' ? [root.id] : [],
    );
    const result = v.parse(bookmarkCommandResultSchema, {
      status: 'acknowledged',
      operationId: purgeCommand.operationId,
      revision: revision + 1,
      folders: [],
      bookmarks: [],
      tags: [],
      sequences: [],
      deletedFolderIds: plan.folderIds,
      deletedBookmarkIds: plan.bookmarkIds,
    });
    await beforeCommandBatch();
    await database.batch([
      database
        .prepare(
          `INSERT INTO bookmark_command_assertions (operation_id, valid)
           SELECT ?, CASE WHEN
             (SELECT revision FROM bookmark_domain_state WHERE name = 'bookmarks') = ?
             AND (SELECT version FROM ${table} WHERE id = ? AND trashed_at IS NOT NULL) = ?
           THEN 1 ELSE 0 END`,
        )
        .bind(purgeCommand.operationId, revision, root.id, root.version),
      ...executeTrashDeletionStatements(database, plan),
      database.prepare(
        "UPDATE bookmark_domain_state SET revision = revision + 1 WHERE name = 'bookmarks'",
      ),
      ...storeResult(purgeCommand, result),
    ]);
    return result;
  };

  const emptyTrash = async (
    emptyCommand: Extract<BookmarkCommand, { type: 'emptyTrash' }>,
  ): Promise<BookmarkCommandResult> => {
    if (emptyCommand.expectedRevision !== revision) return conflict(emptyCommand, 'stale_entity');
    const [folders, bookmarks] = await database.batch<{ id: string }>([
      trashRootsStatement(database, 'bookmark_folders'),
      trashRootsStatement(database, 'bookmarks'),
    ]);
    const plan = await trashDeletionPlan(
      database,
      folders!.results.map((root) => root.id),
      bookmarks!.results.map((root) => root.id),
    );
    const result = v.parse(bookmarkCommandResultSchema, {
      status: 'acknowledged',
      operationId: emptyCommand.operationId,
      revision: revision + 1,
      folders: [],
      bookmarks: [],
      tags: [],
      sequences: [],
      deletedFolderIds: plan.folderIds,
      deletedBookmarkIds: plan.bookmarkIds,
    });
    await beforeCommandBatch();
    await database.batch([
      database
        .prepare(
          `INSERT INTO bookmark_command_assertions (operation_id, valid)
           SELECT ?, CASE WHEN
             (SELECT revision FROM bookmark_domain_state WHERE name = 'bookmarks') = ?
           THEN 1 ELSE 0 END`,
        )
        .bind(emptyCommand.operationId, revision),
      ...executeTrashDeletionStatements(database, plan),
      database.prepare(
        "UPDATE bookmark_domain_state SET revision = revision + 1 WHERE name = 'bookmarks'",
      ),
      ...storeResult(emptyCommand, result),
    ]);
    return result;
  };

  return { trashBookmark, trashFolder, restoreTrash, purgeTrash, emptyTrash };
};

export const expireBookmarkTrash = async (
  database: BookmarkDatabase,
  currentTime: Date,
  randomUUID: () => string,
  beforeCommandBatch: () => Promise<void>,
): Promise<number> => {
  const cutoff = new Date(currentTime.getTime() - TRASH_RETENTION_MS).toISOString();
  const [revisionRow, folderRoots, bookmarkRoots] = await Promise.all([
    revisionStatement(database).first<RevisionRow>(),
    database
      .prepare('SELECT id FROM bookmark_folders WHERE trashed_at IS NOT NULL AND trashed_at <= ?')
      .bind(cutoff)
      .all<{ id: string }>(),
    database
      .prepare('SELECT id FROM bookmarks WHERE trashed_at IS NOT NULL AND trashed_at <= ?')
      .bind(cutoff)
      .all<{ id: string }>(),
    pruneExpiredResults(database, currentTime.toISOString()).all(),
  ]);
  const rootCount = folderRoots.results.length + bookmarkRoots.results.length;
  if (!rootCount) return 0;
  const plan = await trashDeletionPlan(
    database,
    folderRoots.results.map((root) => root.id),
    bookmarkRoots.results.map((root) => root.id),
  );
  const assertionId = randomUUID();
  await beforeCommandBatch();
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO bookmark_command_assertions (operation_id, valid)
           SELECT ?, CASE WHEN
             (SELECT revision FROM bookmark_domain_state WHERE name = 'bookmarks') = ?
             AND ((SELECT COUNT(*) FROM bookmark_folders
                    WHERE trashed_at IS NOT NULL AND trashed_at <= ?)
                + (SELECT COUNT(*) FROM bookmarks
                    WHERE trashed_at IS NOT NULL AND trashed_at <= ?)) = ?
           THEN 1 ELSE 0 END`,
        )
        .bind(assertionId, revisionRow?.revision ?? 0, cutoff, cutoff, rootCount),
      ...executeTrashDeletionStatements(database, plan),
      database.prepare(
        "UPDATE bookmark_domain_state SET revision = revision + 1 WHERE name = 'bookmarks'",
      ),
      database
        .prepare('DELETE FROM bookmark_command_assertions WHERE operation_id = ?')
        .bind(assertionId),
    ]);
  } catch (error) {
    if (isAssertionFailure(error)) return 0;
    throw error;
  }
  return rootCount;
};
