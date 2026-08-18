import * as v from 'valibot';

import {
  BOOKMARK_SNAPSHOT_WIRE_FORMAT_VERSION,
  bookmarkTitleFor,
  bookmarkCommandResultSchema,
  bookmarkCommandSchema,
  bookmarkSnapshotSchema,
  normalizeBookmarkTags,
  visitBookmarkCommand,
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
declare const rankBrand: unique symbol;
type Rank = string & { readonly [rankBrand]: true };
type RankedRow = { id: string; rank: Rank };

const toRank = (value: string): Rank => value as Rank;

type BookmarkServiceOptions = {
  now?: () => Date;
  randomUUID?: () => string;
  beforeCommandBatch?: () => Promise<void>;
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
): Promise<Rank> => {
  const row = await database
    .prepare(`SELECT MAX(rank) AS rank FROM ${table} WHERE ${parentColumn} = ?`)
    .bind(parentId)
    .first<{ rank: string | null }>();
  return toRank(row?.rank ? `${row.rank}z` : 'a');
};

const RANK_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

const rankBetween = (lower: Rank | null, upper: Rank | null): Rank | null => {
  let result = '';
  let upperOpen = upper === null;
  for (let index = 0; index < 64; index += 1) {
    const lowerDigit = lower === null ? 0 : (RANK_ALPHABET.indexOf(lower[index] ?? '0') ?? 0);
    const upperDigit = upperOpen
      ? RANK_ALPHABET.length - 1
      : RANK_ALPHABET.indexOf(upper?.[index] ?? '0');
    if (lowerDigit < 0 || upperDigit < 0 || lowerDigit > upperDigit) return null;
    if (upperDigit - lowerDigit > 1) {
      return toRank(`${result}${RANK_ALPHABET[Math.floor((lowerDigit + upperDigit) / 2)]}`);
    }
    result += RANK_ALPHABET[lowerDigit];
    if (lowerDigit < upperDigit) upperOpen = true;
  }
  return null;
};

const rebalancedRank = (index: number): Rank =>
  toRank(((index + 1) * 1_000_000).toString(36).padStart(12, '0'));

const positionedRanks = (
  siblings: RankedRow[],
  movingId: string,
  beforeId?: string,
): { ranks: Map<string, Rank>; rebalanced: boolean } | null => {
  const remaining = siblings.filter((item) => item.id !== movingId);
  const insertionIndex = beforeId
    ? remaining.findIndex((item) => item.id === beforeId)
    : remaining.length;
  if (beforeId && insertionIndex < 0) return null;
  const previous = remaining[insertionIndex - 1]?.rank ?? null;
  const following = remaining[insertionIndex]?.rank ?? null;
  const rank = rankBetween(previous, following);
  if (rank) return { ranks: new Map([[movingId, rank]]), rebalanced: false };
  const ordered = [...remaining];
  ordered.splice(insertionIndex, 0, { id: movingId, rank: toRank('') });
  return {
    ranks: new Map(ordered.map((item, index) => [item.id, rebalancedRank(index)])),
    rebalanced: true,
  };
};

const organizationPositions = async (
  database: D1Database,
  table: 'bookmark_folders' | 'bookmarks',
  parentColumn: 'parent_id' | 'folder_id',
  destinationId: string,
  movingId: string,
  beforeId?: string,
) => {
  const siblings = await database
    .prepare(
      `SELECT id, rank FROM ${table}
        WHERE ${parentColumn} = ? AND trashed_at IS NULL AND trash_root_id IS NULL
        ORDER BY rank, id`,
    )
    .bind(destinationId)
    .all<RankedRow>();
  return positionedRanks(siblings.results, movingId, beforeId);
};

const updatedOrganizationItems = <Item extends { id: string; rank: string; version: number }>(
  items: Item[],
  ranks: Map<string, Rank>,
  movingId: string,
  timestamp: string,
  relocate: (item: Item) => Item,
): Item[] =>
  [...ranks].map(([id, replacementRank]) => {
    const item = items.find((candidate) => candidate.id === id)!;
    return id === movingId
      ? {
          ...relocate(item),
          rank: replacementRank,
          modifiedAt: timestamp,
          version: item.version + 1,
        }
      : { ...item, rank: replacementRank };
  });

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
  database: D1Database,
  kind: SequenceKind,
  sourceId: string,
  destinationId: string,
): D1PreparedStatement[] =>
  [...new Set([sourceId, destinationId])].map((folderId) =>
    database
      .prepare(
        `UPDATE bookmark_sequences SET version = version + 1 WHERE folder_id = ? AND kind = '${kind}'`,
      )
      .bind(folderId),
  );

export const createBookmarkService = (
  database: D1Database,
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

  const classifyAssertionConflict = (command: BookmarkCommand) =>
    visitBookmarkCommand(command, {
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
    });

  const isAssertionFailure = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('CHECK constraint failed: valid = 1');
  };

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
        const [destinationDepth, subtreeHeight] = await Promise.all([
          database
            .prepare(
              `WITH RECURSIVE ancestors(id, parent_id, depth) AS (
                 SELECT id, parent_id, 0 FROM bookmark_folders WHERE id = ?
                 UNION ALL
                 SELECT parent.id, parent.parent_id, child.depth + 1
                 FROM bookmark_folders parent JOIN ancestors child ON parent.id = child.parent_id
               ) SELECT MAX(depth) AS value FROM ancestors`,
            )
            .bind(destinationId)
            .first<{ value: number }>(),
          database
            .prepare(
              `WITH RECURSIVE descendants(id, depth) AS (
                 SELECT id, 0 FROM bookmark_folders WHERE id = ?
                 UNION ALL
                 SELECT child.id, parent.depth + 1 FROM bookmark_folders child
                 JOIN descendants parent ON child.parent_id = parent.id
                 WHERE child.trashed_at IS NULL AND child.trash_root_id IS NULL
               ) SELECT MAX(depth) AS value FROM descendants`,
            )
            .bind(moving.id)
            .first<{ value: number }>(),
        ]);
        if ((destinationDepth?.value ?? 0) + 1 + (subtreeHeight?.value ?? 0) > 10) {
          return conflict(organizationCommand, 'folder_depth', { folderId: moving.id });
        }
      }

      const currentSnapshot = await readSnapshot(database);
      const updatedFolders = updatedOrganizationItems(
        currentSnapshot.folders,
        positions.ranks,
        moving.id,
        timestamp,
        (folder) => ({ ...folder, parentId: destinationId }),
      );
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
      const currentSnapshot = await readSnapshot(database);
      const updatedBookmarks = updatedOrganizationItems(
        currentSnapshot.bookmarks,
        positions.ranks,
        moving.id,
        timestamp,
        (bookmark) => ({ ...bookmark, folderId: destinationId }),
      );
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
        tags: currentSnapshot.tags.filter((tag) => positions.ranks.has(tag.bookmarkId)),
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
        reorderFolder: organizeFolder,
        moveFolder: organizeFolder,
        reorderBookmark: organizeBookmark,
        moveBookmark: organizeBookmark,
      });
    } catch (error) {
      const settledAfterRace = await database
        .prepare(
          `SELECT result_json AS resultJson
             FROM bookmark_idempotency_results
            WHERE operation_id = ?`,
        )
        .bind(command.operationId)
        .first<IdempotencyRow>();
      if (settledAfterRace) {
        return v.parse(bookmarkCommandResultSchema, JSON.parse(settledAfterRace.resultJson));
      }
      if (!isAssertionFailure(error)) throw error;
      return classifyAssertionConflict(command);
    }
  };

  return {
    getSnapshot: () => readSnapshot(database),
    executeCommand,
  };
};
