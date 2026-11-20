import * as v from 'valibot';

import {
  bookmarkTitleFor,
  bookmarkCommandResultSchema,
  bookmarkCommandSchema,
  normalizeBookmarkTags,
  SYSTEM_ROOT_FOLDER_ID,
  visitBookmarkCommand,
  type Bookmark,
  type BookmarkCommand,
  type BookmarkCommandResult,
  type BookmarkFolder,
  type BookmarkSequence,
  type BookmarkSnapshot,
  type BookmarkTrash,
} from '../../shared/bookmarks/contracts';
import type { BookmarkDatabase, BookmarkDatabaseStatement } from './bookmark-database';

import {
  ACTIVE_BOOKMARK,
  ACTIVE_ROW,
  BOOKMARK_COLUMNS,
  FOLDER_COLUMNS,
  bookmarkStatement,
  bookmarkTagsStatement,
  chunkIds,
  exceedsFolderDepth,
  folderStatement,
  folderSubtreeHeight,
  isAssertionFailure,
  placeholders,
  pruneExpiredResults,
  readBookmarkTags,
  readRows,
  readSnapshot,
  readTrash,
  revisionStatement,
  rowsAt,
  sequenceStatement,
  type BookmarkRow,
  type FolderRow,
  type RevisionRow,
  type SequenceRow,
  type SnapshotRow,
} from './bookmark-queries';
import {
  compareText,
  nextRank,
  organizationPositions,
  positionedRanks,
  updatedOrganizationItems,
  type Rank,
  type RankedRow,
} from './bookmark-ranking';
import { createTrashCommands, expireBookmarkTrash } from './bookmark-trash';

export type BookmarkService = {
  getSnapshot(): Promise<BookmarkSnapshot>;
  getTrash(): Promise<BookmarkTrash>;
  expireTrash(): Promise<number>;
  executeCommand(command: BookmarkCommand): Promise<BookmarkCommandResult>;
};

type IdempotencyRow = { resultJson: string };
type BookmarkServiceOptions = {
  now?: () => Date;
  randomUUID?: () => string;
  beforeCommandBatch?: () => Promise<void>;
};

const resultExpiry = (now: Date): string =>
  new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString();

type OrganizationRequest = {
  sourceId: string;
  destinationId: string;
  sourceExpected: number;
  destinationExpected: number;
  beforeId?: string;
};

const folderOrganizationRequest = (
  command:
    | Extract<BookmarkCommand, { type: 'reorderFolder' }>
    | Extract<BookmarkCommand, { type: 'moveFolder' }>,
): OrganizationRequest =>
  command.type === 'moveFolder'
    ? {
        sourceId: command.sourceParentId,
        destinationId: command.destinationFolderId,
        sourceExpected: command.expectedSourceFolderSequenceVersion,
        destinationExpected: command.expectedDestinationFolderSequenceVersion,
        ...(command.beforeFolderId ? { beforeId: command.beforeFolderId } : {}),
      }
    : {
        sourceId: command.parentId,
        destinationId: command.parentId,
        sourceExpected: command.expectedFolderSequenceVersion,
        destinationExpected: command.expectedFolderSequenceVersion,
        ...(command.beforeFolderId ? { beforeId: command.beforeFolderId } : {}),
      };

const bookmarkOrganizationRequest = (
  command:
    | Extract<BookmarkCommand, { type: 'reorderBookmark' }>
    | Extract<BookmarkCommand, { type: 'moveBookmark' }>,
): OrganizationRequest =>
  command.type === 'moveBookmark'
    ? {
        sourceId: command.sourceFolderId,
        destinationId: command.destinationFolderId,
        sourceExpected: command.expectedSourceBookmarkSequenceVersion,
        destinationExpected: command.expectedDestinationBookmarkSequenceVersion,
        ...(command.beforeBookmarkId ? { beforeId: command.beforeBookmarkId } : {}),
      }
    : {
        sourceId: command.folderId,
        destinationId: command.folderId,
        sourceExpected: command.expectedBookmarkSequenceVersion,
        destinationExpected: command.expectedBookmarkSequenceVersion,
        ...(command.beforeBookmarkId ? { beforeId: command.beforeBookmarkId } : {}),
      };

type SequenceKind = 'folders' | 'bookmarks';

const organizationSequenceResults = (
  kind: SequenceKind,
  sourceId: string,
  destinationId: string,
  source: SequenceRow,
  destination: SequenceRow,
): BookmarkSequence[] => {
  const incremented = (folderId: string, sequence: SequenceRow): BookmarkSequence => ({
    folderId,
    folderVersion: sequence.folderVersion + (kind === 'folders' ? 1 : 0),
    bookmarkVersion: sequence.bookmarkVersion + (kind === 'bookmarks' ? 1 : 0),
  });
  return sourceId === destinationId
    ? [incremented(sourceId, source)]
    : [incremented(sourceId, source), incremented(destinationId, destination)];
};

const organizationSequenceAssertion = (kind: SequenceKind, sameFolder: boolean): string =>
  sameFolder
    ? `(SELECT version FROM bookmark_sequences WHERE folder_id = ? AND kind = '${kind}') = ?`
    : `(SELECT version FROM bookmark_sequences WHERE folder_id = ? AND kind = '${kind}') = ?
       AND (SELECT version FROM bookmark_sequences WHERE folder_id = ? AND kind = '${kind}') = ?`;

const incrementSequenceStatements = (
  database: BookmarkDatabase,
  kind: SequenceKind,
  sourceId: string,
  destinationId: string,
): BookmarkDatabaseStatement[] =>
  [...new Set([sourceId, destinationId])].map((folderId) =>
    database
      .prepare(
        `UPDATE bookmark_sequences SET version = version + 1 WHERE folder_id = ? AND kind = '${kind}'`,
      )
      .bind(folderId),
  );

export const createBookmarkService = (
  database: BookmarkDatabase,
  options: BookmarkServiceOptions = {},
): BookmarkService => {
  const now = options.now ?? (() => new Date());
  const randomUUID = options.randomUUID ?? (() => crypto.randomUUID());
  const beforeCommandBatch = options.beforeCommandBatch ?? (() => Promise.resolve());

  const conflict = async (
    command: BookmarkCommand,
    code: Extract<BookmarkCommandResult, { status: 'conflict' }>['code'],
    filter?: { folderId?: string; bookmarkId?: string; sequenceFolderId?: string },
  ): Promise<BookmarkCommandResult> => {
    const statements = [revisionStatement(database)];
    const folderIndex = filter?.folderId
      ? statements.push(folderStatement(database, filter.folderId)) - 1
      : -1;
    const bookmarkIndex = filter?.bookmarkId
      ? statements.push(bookmarkStatement(database, filter.bookmarkId)) - 1
      : -1;
    const tagIndex = filter?.bookmarkId
      ? statements.push(bookmarkTagsStatement(database, 'bookmark_id = ?', [filter.bookmarkId])) - 1
      : -1;
    const sequenceIndex = filter?.sequenceFolderId
      ? statements.push(sequenceStatement(database, filter.sequenceFolderId)) - 1
      : -1;
    const rows = await database.batch<SnapshotRow>(statements);
    const bookmarks = rowsAt(rows, bookmarkIndex);
    return v.parse(bookmarkCommandResultSchema, {
      status: 'conflict',
      operationId: command.operationId,
      code,
      revision: rowsAt(rows, 0)[0]?.revision,
      folders: rowsAt(rows, folderIndex),
      bookmarks,
      tags: bookmarks.length ? rowsAt(rows, tagIndex) : [],
      sequences: rowsAt(rows, sequenceIndex),
    });
  };

  const storeResultStatements = (
    command: BookmarkCommand,
    result: BookmarkCommandResult,
    timestamp: string,
    expiresAt: string,
  ): BookmarkDatabaseStatement[] => [
    pruneExpiredResults(database, timestamp),
    database
      .prepare(
        'DELETE FROM bookmark_idempotency_results WHERE operation_id = ? AND expires_at <= ?',
      )
      .bind(command.operationId, timestamp),
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

  const classifyAssertionConflict = (command: BookmarkCommand) =>
    visitBookmarkCommand(command, {
      async setBookmarkPin(pinCommand) {
        return conflict(pinCommand, 'stale_sequence');
      },
      async createFolder(createCommand) {
        const [parent, duplicate] = await Promise.all([
          folderStatement(database, createCommand.parentId).first<FolderRow>(),
          database
            .prepare(
              `SELECT id FROM bookmark_folders
                WHERE parent_id = ? AND name = ?
                  AND trashed_at IS NULL AND trash_root_id IS NULL`,
            )
            .bind(createCommand.parentId, createCommand.name)
            .first<{ id: string }>(),
        ]);
        if (!parent) return conflict(createCommand, 'missing_entity');
        if (duplicate) {
          return conflict(createCommand, 'name_conflict', { folderId: duplicate.id });
        }
        return conflict(createCommand, 'stale_sequence', {
          sequenceFolderId: createCommand.parentId,
        });
      },
      async editFolder(editCommand) {
        const folder = await folderStatement(database, editCommand.folderId).first<FolderRow>();
        if (!folder) return conflict(editCommand, 'missing_entity');
        const duplicate = await database
          .prepare(
            `SELECT id FROM bookmark_folders
              WHERE parent_id IS ? AND name = ? AND id != ?
                AND trashed_at IS NULL AND trash_root_id IS NULL`,
          )
          .bind(folder.parentId, editCommand.name, editCommand.folderId)
          .first<{ id: string }>();
        if (duplicate) {
          return conflict(editCommand, 'name_conflict', { folderId: duplicate.id });
        }
        return conflict(editCommand, 'stale_entity', { folderId: editCommand.folderId });
      },
      async createBookmark(createCommand) {
        const folder = await folderStatement(database, createCommand.folderId).first<FolderRow>();
        return folder
          ? conflict(createCommand, 'stale_sequence', {
              sequenceFolderId: createCommand.folderId,
            })
          : conflict(createCommand, 'missing_entity');
      },
      async editBookmark(editCommand) {
        const bookmark = await bookmarkStatement(
          database,
          editCommand.bookmarkId,
        ).first<BookmarkRow>();
        return bookmark
          ? conflict(editCommand, 'stale_entity', { bookmarkId: editCommand.bookmarkId })
          : conflict(editCommand, 'missing_entity');
      },
      async reorderFolder(reorderCommand) {
        const folder = await folderStatement(database, reorderCommand.folderId).first<FolderRow>();
        if (!folder) return conflict(reorderCommand, 'missing_entity');
        if (folder.version !== reorderCommand.folderVersion) {
          return conflict(reorderCommand, 'stale_entity', { folderId: folder.id });
        }
        return conflict(reorderCommand, 'stale_sequence', {
          sequenceFolderId: reorderCommand.parentId,
        });
      },
      async moveFolder(moveCommand) {
        const folder = await folderStatement(database, moveCommand.folderId).first<FolderRow>();
        if (
          !folder ||
          !(await folderStatement(database, moveCommand.destinationFolderId).first())
        ) {
          return conflict(moveCommand, 'missing_entity');
        }
        if (
          folder.version !== moveCommand.folderVersion ||
          folder.parentId !== moveCommand.sourceParentId
        ) {
          return conflict(moveCommand, 'stale_entity', { folderId: folder.id });
        }
        return conflict(moveCommand, 'stale_sequence', {
          sequenceFolderId: moveCommand.sourceParentId,
        });
      },
      async reorderBookmark(reorderCommand) {
        const bookmark = await bookmarkStatement(
          database,
          reorderCommand.bookmarkId,
        ).first<BookmarkRow>();
        if (!bookmark) return conflict(reorderCommand, 'missing_entity');
        if (bookmark.version !== reorderCommand.bookmarkVersion) {
          return conflict(reorderCommand, 'stale_entity', { bookmarkId: bookmark.id });
        }
        return conflict(reorderCommand, 'stale_sequence', {
          sequenceFolderId: reorderCommand.folderId,
        });
      },
      async moveBookmark(moveCommand) {
        const bookmark = await bookmarkStatement(
          database,
          moveCommand.bookmarkId,
        ).first<BookmarkRow>();
        if (
          !bookmark ||
          !(await folderStatement(database, moveCommand.destinationFolderId).first())
        ) {
          return conflict(moveCommand, 'missing_entity');
        }
        if (
          bookmark.version !== moveCommand.bookmarkVersion ||
          bookmark.folderId !== moveCommand.sourceFolderId
        ) {
          return conflict(moveCommand, 'stale_entity', { bookmarkId: bookmark.id });
        }
        return conflict(moveCommand, 'stale_sequence', {
          sequenceFolderId: moveCommand.sourceFolderId,
        });
      },
      async trashBookmark(command) {
        return conflict(command, 'missing_entity');
      },
      async trashFolder(command) {
        return conflict(command, 'missing_entity');
      },
      async restoreTrash(command) {
        return conflict(command, 'missing_entity');
      },
      async purgeTrash(command) {
        return conflict(command, 'missing_entity');
      },
      async emptyTrash(command) {
        return conflict(command, 'stale_entity');
      },
    });

  const readSettledResult = (operationId: string, timestamp: string) =>
    database
      .prepare(
        `SELECT result_json AS resultJson FROM bookmark_idempotency_results
          WHERE operation_id = ? AND expires_at > ?`,
      )
      .bind(operationId, timestamp)
      .first<IdempotencyRow>();

  const executeCommand = async (input: BookmarkCommand): Promise<BookmarkCommandResult> => {
    const command = v.parse(bookmarkCommandSchema, input);
    const timestamp = now().toISOString();
    const settled = await readSettledResult(command.operationId, timestamp);
    if (settled) return v.parse(bookmarkCommandResultSchema, JSON.parse(settled.resultJson));

    const revisionRow = await revisionStatement(database).first<RevisionRow>();
    const revision = revisionRow?.revision ?? 0;
    const expiresAt = resultExpiry(new Date(timestamp));

    const commitOrganization = async (options: {
      command: BookmarkCommand;
      kind: SequenceKind;
      table: 'bookmark_folders' | 'bookmarks';
      parentColumn: 'parent_id' | 'folder_id';
      entityId: string;
      entityVersion: number;
      sourceId: string;
      destinationId: string;
      sourceExpected: number;
      destinationExpected: number;
      positions: { ranks: Map<string, Rank> };
      result: BookmarkCommandResult;
    }): Promise<void> => {
      const sameFolder = options.sourceId === options.destinationId;
      const sequenceAssertion = organizationSequenceAssertion(options.kind, sameFolder);
      await beforeCommandBatch();
      await database.batch([
        database
          .prepare(
            `INSERT INTO bookmark_command_assertions (operation_id, valid)
             SELECT ?, CASE WHEN
               (SELECT revision FROM bookmark_domain_state WHERE name = 'bookmarks') = ?
               AND (SELECT version FROM ${options.table} WHERE id = ? AND ${options.parentColumn} = ?) = ?
               AND ${sequenceAssertion}
             THEN 1 ELSE 0 END`,
          )
          .bind(
            options.command.operationId,
            revision,
            options.entityId,
            options.sourceId,
            options.entityVersion,
            options.sourceId,
            options.sourceExpected,
            ...(sameFolder ? [] : [options.destinationId, options.destinationExpected]),
          ),
        ...[...options.positions.ranks].map(([id, replacementRank]) =>
          database
            .prepare(`UPDATE ${options.table} SET rank = ? WHERE id = ?`)
            .bind(replacementRank, id),
        ),
        database
          .prepare(
            `UPDATE ${options.table}
                SET ${options.parentColumn} = ?, rank = ?, modified_at = ?, version = version + 1
              WHERE id = ?`,
          )
          .bind(
            options.destinationId,
            options.positions.ranks.get(options.entityId),
            timestamp,
            options.entityId,
          ),
        ...incrementSequenceStatements(
          database,
          options.kind,
          options.sourceId,
          options.destinationId,
        ),
        database.prepare(
          "UPDATE bookmark_domain_state SET revision = revision + 1 WHERE name = 'bookmarks'",
        ),
        ...storeResultStatements(options.command, options.result, timestamp, expiresAt),
      ]);
    };

    const organizeFolder = async (
      organizationCommand:
        | Extract<BookmarkCommand, { type: 'reorderFolder' }>
        | Extract<BookmarkCommand, { type: 'moveFolder' }>,
    ): Promise<BookmarkCommandResult> => {
      const moving = await folderStatement(
        database,
        organizationCommand.folderId,
      ).first<FolderRow>();
      const { sourceId, destinationId, sourceExpected, destinationExpected, beforeId } =
        folderOrganizationRequest(organizationCommand);
      const [sourceSequence, destinationSequence, destination] = await Promise.all([
        sequenceStatement(database, sourceId).first<SequenceRow>(),
        sequenceStatement(database, destinationId).first<SequenceRow>(),
        folderStatement(database, destinationId).first<FolderRow>(),
      ]);
      if (!moving || !sourceSequence || !destinationSequence || !destination) {
        return conflict(organizationCommand, 'missing_entity');
      }
      if (moving.version !== organizationCommand.folderVersion) {
        return conflict(organizationCommand, 'stale_entity', { folderId: moving.id });
      }
      if (moving.parentId !== sourceId) {
        return conflict(organizationCommand, 'stale_entity', { folderId: moving.id });
      }
      if (
        sourceSequence.folderVersion !== sourceExpected ||
        destinationSequence.folderVersion !== destinationExpected
      ) {
        return conflict(organizationCommand, 'stale_sequence', {
          sequenceFolderId:
            sourceSequence.folderVersion !== sourceExpected ? sourceId : destinationId,
        });
      }
      const positions = await organizationPositions(
        database,
        'bookmark_folders',
        'parent_id',
        destinationId,
        moving.id,
        beforeId,
      );
      if (!positions) return conflict(organizationCommand, 'invalid_position');

      if (sourceId !== destinationId) {
        const duplicate = await database
          .prepare(
            `SELECT id FROM bookmark_folders
              WHERE parent_id = ? AND name = ? AND id != ?
                AND trashed_at IS NULL AND trash_root_id IS NULL`,
          )
          .bind(destinationId, moving.name, moving.id)
          .first<{ id: string }>();
        if (duplicate)
          return conflict(organizationCommand, 'name_conflict', { folderId: duplicate.id });
        const cycle = await database
          .prepare(
            `WITH RECURSIVE descendants(id) AS (
               SELECT id FROM bookmark_folders WHERE id = ?
               UNION ALL
               SELECT child.id FROM bookmark_folders child
               JOIN descendants parent ON child.parent_id = parent.id
               WHERE child.trashed_at IS NULL AND child.trash_root_id IS NULL
             ) SELECT id FROM descendants WHERE id = ?`,
          )
          .bind(moving.id, destinationId)
          .first<{ id: string }>();
        if (cycle) return conflict(organizationCommand, 'folder_cycle', { folderId: moving.id });
        if (
          await exceedsFolderDepth(
            database,
            destinationId,
            folderSubtreeHeight(database, moving.id),
          )
        ) {
          return conflict(organizationCommand, 'folder_depth', { folderId: moving.id });
        }
      }

      const siblings = positions.rebalanced
        ? (
            await database
              .prepare(
                `SELECT ${FOLDER_COLUMNS} FROM bookmark_folders WHERE parent_id = ? AND ${ACTIVE_ROW}`,
              )
              .bind(destinationId)
              .all<FolderRow>()
          ).results
        : [];
      const updatedFolders = updatedOrganizationItems(
        siblings,
        positions.ranks,
        moving,
        timestamp,
        (folder) => ({ ...folder, parentId: destinationId }),
      );
      if (!updatedFolders) {
        return conflict(organizationCommand, 'stale_sequence', { sequenceFolderId: destinationId });
      }
      const updatedSequences = organizationSequenceResults(
        'folders',
        sourceId,
        destinationId,
        sourceSequence,
        destinationSequence,
      );
      const result = v.parse(bookmarkCommandResultSchema, {
        status: 'acknowledged',
        operationId: organizationCommand.operationId,
        revision: revision + 1,
        folders: updatedFolders,
        bookmarks: [],
        tags: [],
        sequences: updatedSequences,
      });
      await commitOrganization({
        command: organizationCommand,
        kind: 'folders',
        table: 'bookmark_folders',
        parentColumn: 'parent_id',
        entityId: moving.id,
        entityVersion: organizationCommand.folderVersion,
        sourceId,
        destinationId,
        sourceExpected,
        destinationExpected,
        positions,
        result,
      });
      return result;
    };

    const organizeBookmark = async (
      organizationCommand:
        | Extract<BookmarkCommand, { type: 'reorderBookmark' }>
        | Extract<BookmarkCommand, { type: 'moveBookmark' }>,
    ): Promise<BookmarkCommandResult> => {
      const moving = await bookmarkStatement(
        database,
        organizationCommand.bookmarkId,
      ).first<BookmarkRow>();
      const { sourceId, destinationId, sourceExpected, destinationExpected, beforeId } =
        bookmarkOrganizationRequest(organizationCommand);
      const [sourceSequence, destinationSequence, destination] = await Promise.all([
        sequenceStatement(database, sourceId).first<SequenceRow>(),
        sequenceStatement(database, destinationId).first<SequenceRow>(),
        folderStatement(database, destinationId).first<FolderRow>(),
      ]);
      if (!moving || !sourceSequence || !destinationSequence || !destination) {
        return conflict(organizationCommand, 'missing_entity');
      }
      if (moving.version !== organizationCommand.bookmarkVersion || moving.folderId !== sourceId) {
        return conflict(organizationCommand, 'stale_entity', { bookmarkId: moving.id });
      }
      if (
        sourceSequence.bookmarkVersion !== sourceExpected ||
        destinationSequence.bookmarkVersion !== destinationExpected
      ) {
        return conflict(organizationCommand, 'stale_sequence', {
          sequenceFolderId:
            sourceSequence.bookmarkVersion !== sourceExpected ? sourceId : destinationId,
        });
      }
      const positions = await organizationPositions(
        database,
        'bookmarks',
        'folder_id',
        destinationId,
        moving.id,
        beforeId,
      );
      if (!positions) return conflict(organizationCommand, 'invalid_position');
      const [siblings, tags] = await Promise.all([
        positions.rebalanced
          ? database
              .prepare(
                `SELECT ${BOOKMARK_COLUMNS} FROM bookmarks WHERE folder_id = ? AND ${ACTIVE_BOOKMARK}`,
              )
              .bind(destinationId)
              .all<BookmarkRow>()
              .then((rows) => rows.results)
          : [],
        readBookmarkTags(database, [...positions.ranks.keys()]),
      ]);
      const updatedBookmarks = updatedOrganizationItems(
        siblings,
        positions.ranks,
        moving,
        timestamp,
        (bookmark) => ({ ...bookmark, folderId: destinationId }),
      );
      if (!updatedBookmarks) {
        return conflict(organizationCommand, 'stale_sequence', { sequenceFolderId: destinationId });
      }
      const updatedSequences = organizationSequenceResults(
        'bookmarks',
        sourceId,
        destinationId,
        sourceSequence,
        destinationSequence,
      );
      const result = v.parse(bookmarkCommandResultSchema, {
        status: 'acknowledged',
        operationId: organizationCommand.operationId,
        revision: revision + 1,
        folders: [],
        bookmarks: updatedBookmarks,
        tags,
        sequences: updatedSequences,
      });
      await commitOrganization({
        command: organizationCommand,
        kind: 'bookmarks',
        table: 'bookmarks',
        parentColumn: 'folder_id',
        entityId: moving.id,
        entityVersion: organizationCommand.bookmarkVersion,
        sourceId,
        destinationId,
        sourceExpected,
        destinationExpected,
        positions,
        result,
      });
      return result;
    };

    try {
      return await visitBookmarkCommand(command, {
        createFolder: async (command) => {
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
          if (await exceedsFolderDepth(database, command.parentId)) {
            return conflict(command, 'folder_depth', { folderId: command.parentId });
          }

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
            sequences: [
              updatedSequence,
              { folderId: folder.id, folderVersion: 1, bookmarkVersion: 1 },
            ],
          });
          await beforeCommandBatch();
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
        },

        editFolder: async (command) => {
          if (command.folderId === SYSTEM_ROOT_FOLDER_ID)
            return conflict(command, 'missing_entity');
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
          await beforeCommandBatch();
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
        },

        createBookmark: async (command) => {
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
            pinRank: null,
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
          await beforeCommandBatch();
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
        },

        editBookmark: async (command) => {
          const bookmark = await bookmarkStatement(
            database,
            command.bookmarkId,
          ).first<BookmarkRow>();
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
          await beforeCommandBatch();
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
            database
              .prepare('DELETE FROM bookmark_tags WHERE bookmark_id = ?')
              .bind(command.bookmarkId),
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
        },
        setBookmarkPin: async (command) => {
          if (revision !== command.expectedRevision) return conflict(command, 'stale_sequence');
          const bookmark = await bookmarkStatement(
            database,
            command.bookmarkId,
          ).first<BookmarkRow>();
          if (!bookmark) return conflict(command, 'missing_entity');
          if (command.beforeBookmarkId) {
            if (!command.pinned) return conflict(command, 'invalid_position');
            const before = await database
              .prepare(
                `SELECT id FROM bookmarks WHERE id = ? AND pin_rank IS NOT NULL AND ${ACTIVE_BOOKMARK}`,
              )
              .bind(command.beforeBookmarkId)
              .first<{ id: string }>();
            if (!before) return conflict(command, 'invalid_position');
          }
          // Include hidden pins so restoring Trash preserves its place even after a rebalance.
          const positions = command.pinned
            ? positionedRanks(
                (
                  await database
                    .prepare(
                      'SELECT id, pin_rank AS rank FROM bookmarks WHERE pin_rank IS NOT NULL ORDER BY pin_rank, id',
                    )
                    .all<RankedRow>()
                ).results,
                bookmark.id,
                command.beforeBookmarkId,
              )
            : { ranks: new Map<string, Rank | null>([[bookmark.id, null]]), rebalanced: false };
          if (!positions) return conflict(command, 'invalid_position');
          const affectedBookmarks = positions.rebalanced
            ? await readRows<BookmarkRow>(
                database,
                chunkIds([...positions.ranks.keys()]).map((ids) =>
                  database
                    .prepare(
                      `SELECT ${BOOKMARK_COLUMNS} FROM bookmarks
                        WHERE id IN (${placeholders(ids)}) AND ${ACTIVE_BOOKMARK}`,
                    )
                    .bind(...ids),
                ),
              )
            : [bookmark];
          const tags = await readBookmarkTags(
            database,
            affectedBookmarks.map((item) => item.id),
          );
          affectedBookmarks.sort(
            (left, right) =>
              compareText(left.folderId, right.folderId) ||
              compareText(left.rank, right.rank) ||
              compareText(left.id, right.id),
          );
          const result = v.parse(bookmarkCommandResultSchema, {
            status: 'acknowledged',
            operationId: command.operationId,
            revision: revision + 1,
            folders: [],
            bookmarks: affectedBookmarks.map((item) => ({
              ...item,
              pinRank: positions.ranks.get(item.id),
            })),
            tags,
            sequences: [],
          });
          await beforeCommandBatch();
          await database.batch([
            database
              .prepare(`INSERT INTO bookmark_command_assertions (operation_id, valid)
              SELECT ?, CASE WHEN
                (SELECT revision FROM bookmark_domain_state WHERE name = 'bookmarks') = ?
              THEN 1 ELSE 0 END`)
              .bind(command.operationId, revision),
            ...[...positions.ranks].map(([id, rank]) =>
              database.prepare('UPDATE bookmarks SET pin_rank = ? WHERE id = ?').bind(rank, id),
            ),
            database.prepare(
              "UPDATE bookmark_domain_state SET revision = revision + 1 WHERE name = 'bookmarks'",
            ),
            ...storeResultStatements(command, result, timestamp, expiresAt),
          ]);
          return result;
        },
        reorderFolder: organizeFolder,
        moveFolder: organizeFolder,
        reorderBookmark: organizeBookmark,
        moveBookmark: organizeBookmark,
        ...createTrashCommands({
          database,
          timestamp,
          revision,
          beforeCommandBatch,
          conflict,
          storeResult: (command, result) =>
            storeResultStatements(command, result, timestamp, expiresAt),
        }),
      });
    } catch (error) {
      const settledAfterRace = await readSettledResult(command.operationId, timestamp);
      if (settledAfterRace) {
        return v.parse(bookmarkCommandResultSchema, JSON.parse(settledAfterRace.resultJson));
      }
      if (!isAssertionFailure(error)) throw error;
      return classifyAssertionConflict(command);
    }
  };

  const expireTrash = () => expireBookmarkTrash(database, now(), randomUUID, beforeCommandBatch);

  return {
    getSnapshot: () => readSnapshot(database),
    getTrash: async () => {
      await expireTrash();
      return readTrash(database);
    },
    expireTrash,
    executeCommand,
  };
};
