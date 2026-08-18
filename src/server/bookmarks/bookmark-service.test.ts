import { readFile } from 'node:fs/promises';

import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SYSTEM_ROOT_FOLDER_ID } from '../../shared/bookmarks/contracts';
import { createBookmarkService } from './bookmark-service';

const now = '2026-08-18T12:00:00.000Z';

describe('Bookmark Service Interface', () => {
  let miniflare: Miniflare;
  let database: D1Database;

  beforeEach(async () => {
    miniflare = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: 'export default { fetch() { return new Response("ok") } }',
        compatibilityDate: '2026-08-18',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB'],
      }),
    );
    database = await miniflare.getD1Database('DB');
    for (const path of [
      'migrations/0001_initial_bookmark_schema.sql',
      'migrations/0002_bookmark_commands.sql',
    ]) {
      const migration = await readFile(path, 'utf8');
      for (const statement of migration
        .split(';')
        .map((sql) => sql.trim())
        .filter(Boolean)) {
        await database.prepare(statement).run();
      }
    }
  });

  afterEach(async () => {
    await miniflare.dispose();
  });

  it('returns one validated flat snapshot with active records in stable order', async () => {
    await database.batch([
      database
        .prepare(
          `INSERT INTO bookmark_folders
            (id, name, parent_id, rank, created_at, modified_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          '10000000-0000-4000-8000-000000000001',
          'Work',
          SYSTEM_ROOT_FOLDER_ID,
          'b',
          now,
          now,
          3,
        ),
      database
        .prepare(
          `INSERT INTO bookmark_folders
            (id, name, parent_id, rank, created_at, modified_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          '10000000-0000-4000-8000-000000000002',
          'work',
          SYSTEM_ROOT_FOLDER_ID,
          'a',
          now,
          now,
          1,
        ),
      database
        .prepare('INSERT INTO bookmark_sequences (folder_id, kind, version) VALUES (?, ?, ?)')
        .bind('10000000-0000-4000-8000-000000000001', 'folders', 4),
      database
        .prepare('INSERT INTO bookmark_sequences (folder_id, kind, version) VALUES (?, ?, ?)')
        .bind('10000000-0000-4000-8000-000000000001', 'bookmarks', 5),
      database
        .prepare(
          `INSERT INTO bookmarks
            (id, folder_id, url, title, note, rank, created_at, modified_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          '20000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000001',
          'https://example.com/path',
          'Example',
          'A useful note',
          'b',
          now,
          now,
          2,
        ),
      database
        .prepare(
          `INSERT INTO bookmarks
            (id, folder_id, url, title, note, rank, created_at, modified_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          '20000000-0000-4000-8000-000000000002',
          '10000000-0000-4000-8000-000000000001',
          'https://example.com/path',
          'Duplicate destination',
          '',
          'a',
          now,
          now,
          1,
        ),
      database
        .prepare(
          'INSERT INTO bookmark_tags (bookmark_id, display_value, lowercase_key) VALUES (?, ?, ?)',
        )
        .bind('20000000-0000-4000-8000-000000000001', '旅行', '旅行'),
      database.prepare("UPDATE bookmark_domain_state SET revision = 9 WHERE name = 'bookmarks'"),
    ]);

    const snapshot = await createBookmarkService(database).getSnapshot();

    expect(snapshot).toMatchObject({
      wireFormatVersion: 1,
      revision: 9,
      folders: [
        { id: SYSTEM_ROOT_FOLDER_ID, name: '', parentId: null },
        { id: '10000000-0000-4000-8000-000000000002', name: 'work' },
        { id: '10000000-0000-4000-8000-000000000001', name: 'Work' },
      ],
      bookmarks: [
        { id: '20000000-0000-4000-8000-000000000002', title: 'Duplicate destination' },
        { id: '20000000-0000-4000-8000-000000000001', title: 'Example' },
      ],
      tags: [
        {
          bookmarkId: '20000000-0000-4000-8000-000000000001',
          value: '旅行',
        },
      ],
    });
    expect(snapshot.sequences).toContainEqual({
      folderId: '10000000-0000-4000-8000-000000000001',
      folderVersion: 4,
      bookmarkVersion: 5,
    });
  });

  it('supports ten Folder levels, empty Folders, and maximum field sizes', async () => {
    let parentId = SYSTEM_ROOT_FOLDER_ID;
    const statements: D1PreparedStatement[] = [];
    for (let depth = 1; depth <= 10; depth += 1) {
      const id = `30000000-0000-4000-8000-${depth.toString().padStart(12, '0')}`;
      statements.push(
        database
          .prepare(
            `INSERT INTO bookmark_folders
              (id, name, parent_id, rank, created_at, modified_at, version)
             VALUES (?, ?, ?, ?, ?, ?, 1)`,
          )
          .bind(id, depth === 10 ? 'x'.repeat(256) : `Level ${depth}`, parentId, 'a', now, now),
        database
          .prepare('INSERT INTO bookmark_sequences (folder_id, kind, version) VALUES (?, ?, 1)')
          .bind(id, 'folders'),
        database
          .prepare('INSERT INTO bookmark_sequences (folder_id, kind, version) VALUES (?, ?, 1)')
          .bind(id, 'bookmarks'),
      );
      parentId = id;
    }
    statements.push(
      database
        .prepare(
          `INSERT INTO bookmarks
            (id, folder_id, url, title, note, rank, created_at, modified_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .bind(
          '40000000-0000-4000-8000-000000000001',
          parentId,
          `https://example.com/${'u'.repeat(8172)}`,
          't'.repeat(256),
          'n'.repeat(32768),
          'a',
          now,
          now,
        ),
    );
    for (let tag = 0; tag < 50; tag += 1) {
      const value = `${tag.toString().padStart(2, '0')}-${'界'.repeat(61)}`;
      statements.push(
        database
          .prepare(
            'INSERT INTO bookmark_tags (bookmark_id, display_value, lowercase_key) VALUES (?, ?, ?)',
          )
          .bind('40000000-0000-4000-8000-000000000001', value, value),
      );
    }
    await database.batch(statements);

    const snapshot = await createBookmarkService(database).getSnapshot();

    expect(snapshot.folders).toHaveLength(11);
    expect(snapshot.bookmarks[0]).toMatchObject({
      title: 't'.repeat(256),
      note: 'n'.repeat(32768),
    });
    expect(snapshot.tags).toHaveLength(50);
  });

  it('excludes trashed Folder trees and Bookmarks', async () => {
    await database.batch([
      database
        .prepare(
          `INSERT INTO bookmark_folders
            (id, name, parent_id, rank, created_at, modified_at, version, trashed_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        )
        .bind(
          '50000000-0000-4000-8000-000000000001',
          'Deleted',
          SYSTEM_ROOT_FOLDER_ID,
          'a',
          now,
          now,
          now,
        ),
      database
        .prepare(
          `INSERT INTO bookmarks
            (id, folder_id, url, title, note, rank, created_at, modified_at, version, trashed_at)
           VALUES (?, ?, ?, ?, '', ?, ?, ?, 1, ?)`,
        )
        .bind(
          '60000000-0000-4000-8000-000000000001',
          SYSTEM_ROOT_FOLDER_ID,
          'https://example.com',
          'Deleted',
          'a',
          now,
          now,
          now,
        ),
    ]);

    const snapshot = await createBookmarkService(database).getSnapshot();

    expect(snapshot.folders.map((folder) => folder.name)).toEqual(['']);
    expect(snapshot.bookmarks).toEqual([]);
  });

  it('creates Folders with exact names, permits case variants, and settles repeated operations once', async () => {
    const service = createBookmarkService(database, {
      now: () => new Date(now),
      randomUUID: (() => {
        const ids = [
          '70000000-0000-4000-8000-000000000001',
          '70000000-0000-4000-8000-000000000002',
        ];
        return () => ids.shift()!;
      })(),
    });
    const command = {
      type: 'createFolder' as const,
      operationId: 'a0000000-0000-4000-8000-000000000001',
      parentId: SYSTEM_ROOT_FOLDER_ID,
      expectedFolderSequenceVersion: 1,
      name: '  Work  ',
    };

    const first = await service.executeCommand(command);
    const repeated = await service.executeCommand(command);
    const caseVariant = await service.executeCommand({
      ...command,
      operationId: 'a0000000-0000-4000-8000-000000000002',
      expectedFolderSequenceVersion: 2,
      name: '  work  ',
    });

    expect(first).toMatchObject({
      status: 'acknowledged',
      revision: 1,
      folders: [{ name: '  Work  ', version: 1, createdAt: now, modifiedAt: now }],
      sequences: [{ folderId: SYSTEM_ROOT_FOLDER_ID, folderVersion: 2 }],
    });
    expect(repeated).toEqual(first);
    expect(caseVariant).toMatchObject({ status: 'acknowledged', revision: 2 });
    expect((await service.getSnapshot()).folders.map((folder) => folder.name)).toEqual([
      '',
      '  Work  ',
      '  work  ',
    ]);
  });

  it('returns authoritative conflicts for exact sibling names and stale versions', async () => {
    const service = createBookmarkService(database, {
      now: () => new Date(now),
      randomUUID: () => '71000000-0000-4000-8000-000000000001',
    });
    await service.executeCommand({
      type: 'createFolder',
      operationId: 'a1000000-0000-4000-8000-000000000001',
      parentId: SYSTEM_ROOT_FOLDER_ID,
      expectedFolderSequenceVersion: 1,
      name: 'Reading',
    });

    const duplicate = await service.executeCommand({
      type: 'createFolder',
      operationId: 'a1000000-0000-4000-8000-000000000002',
      parentId: SYSTEM_ROOT_FOLDER_ID,
      expectedFolderSequenceVersion: 2,
      name: 'Reading',
    });
    const stale = await service.executeCommand({
      type: 'editFolder',
      operationId: 'a1000000-0000-4000-8000-000000000003',
      folderId: '71000000-0000-4000-8000-000000000001',
      folderVersion: 99,
      name: 'Saved',
    });

    expect(duplicate).toMatchObject({ status: 'conflict', code: 'name_conflict', revision: 1 });
    expect(stale).toMatchObject({
      status: 'conflict',
      code: 'stale_entity',
      folders: [{ id: '71000000-0000-4000-8000-000000000001', name: 'Reading', version: 1 }],
    });
  });

  it('creates and edits duplicate-URL Bookmarks with normalized Tags and immutable creation time', async () => {
    const ids = ['72000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002'];
    let clock = now;
    const service = createBookmarkService(database, {
      now: () => new Date(clock),
      randomUUID: () => ids.shift()!,
    });
    const created = await service.executeCommand({
      type: 'createBookmark',
      operationId: 'a2000000-0000-4000-8000-000000000001',
      folderId: SYSTEM_ROOT_FOLDER_ID,
      expectedBookmarkSequenceVersion: 1,
      url: 'https://example.com/path',
      note: '',
      tags: [' Travel ', 'travel', 'CAFÉ'],
    });
    await service.executeCommand({
      type: 'createBookmark',
      operationId: 'a2000000-0000-4000-8000-000000000002',
      folderId: SYSTEM_ROOT_FOLDER_ID,
      expectedBookmarkSequenceVersion: 2,
      url: 'https://example.com/path',
      title: 'Duplicate',
      note: '',
      tags: [],
    });
    clock = '2026-08-18T13:00:00.000Z';
    const edited = await service.executeCommand({
      type: 'editBookmark',
      operationId: 'a2000000-0000-4000-8000-000000000003',
      bookmarkId: '72000000-0000-4000-8000-000000000001',
      bookmarkVersion: 1,
      url: 'http://example.org/new',
      title: 'Updated',
      note: 'Plain text <script>',
      tags: [' zed ', 'Alpha'],
    });

    expect(created).toMatchObject({
      status: 'acknowledged',
      bookmarks: [{ title: 'example.com', createdAt: now }],
      tags: [{ value: 'CAFÉ' }, { value: 'Travel' }],
    });
    expect(edited).toMatchObject({
      status: 'acknowledged',
      bookmarks: [
        {
          title: 'Updated',
          note: 'Plain text <script>',
          createdAt: now,
          modifiedAt: clock,
          version: 2,
        },
      ],
      tags: [{ value: 'Alpha' }, { value: 'zed' }],
    });
    expect((await service.getSnapshot()).bookmarks).toHaveLength(2);
  });

  it('rolls back entity, sequence, revision, and idempotency changes when a command batch fails', async () => {
    const service = createBookmarkService(database, {
      now: () => new Date(now),
      randomUUID: () => '73000000-0000-4000-8000-000000000001',
    });
    await service.executeCommand({
      type: 'createFolder',
      operationId: 'a3000000-0000-4000-8000-000000000001',
      parentId: SYSTEM_ROOT_FOLDER_ID,
      expectedFolderSequenceVersion: 1,
      name: 'First',
    });

    await expect(
      service.executeCommand({
        type: 'createFolder',
        operationId: 'a3000000-0000-4000-8000-000000000002',
        parentId: SYSTEM_ROOT_FOLDER_ID,
        expectedFolderSequenceVersion: 2,
        name: 'Second',
      }),
    ).rejects.toThrow();

    const snapshot = await service.getSnapshot();
    expect(snapshot).toMatchObject({ revision: 1 });
    expect(snapshot.folders.map((folder) => folder.name)).toEqual(['', 'First']);
    expect(snapshot.sequences).toContainEqual({
      folderId: SYSTEM_ROOT_FOLDER_ID,
      folderVersion: 2,
      bookmarkVersion: 1,
    });
    await expect(
      database
        .prepare('SELECT operation_id FROM bookmark_idempotency_results ORDER BY operation_id')
        .all(),
    ).resolves.toMatchObject({
      results: [{ operation_id: 'a3000000-0000-4000-8000-000000000001' }],
    });
  });

  it('returns a structured conflict when a precondition changes immediately before the batch', async () => {
    const setupService = createBookmarkService(database, {
      now: () => new Date(now),
      randomUUID: () => '74000000-0000-4000-8000-000000000001',
    });
    await setupService.executeCommand({
      type: 'createFolder',
      operationId: 'a4000000-0000-4000-8000-000000000001',
      parentId: SYSTEM_ROOT_FOLDER_ID,
      expectedFolderSequenceVersion: 1,
      name: 'Initial',
    });
    let raced = false;
    const service = createBookmarkService(database, {
      now: () => new Date(now),
      beforeCommandBatch: async () => {
        if (raced) return;
        raced = true;
        await database.batch([
          database
            .prepare('UPDATE bookmark_folders SET name = ?, version = version + 1 WHERE id = ?')
            .bind('Concurrent', '74000000-0000-4000-8000-000000000001'),
          database.prepare(
            "UPDATE bookmark_domain_state SET revision = revision + 1 WHERE name = 'bookmarks'",
          ),
        ]);
      },
    });

    const result = await service.executeCommand({
      type: 'editFolder',
      operationId: 'a4000000-0000-4000-8000-000000000002',
      folderId: '74000000-0000-4000-8000-000000000001',
      folderVersion: 1,
      name: 'Owner edit',
    });

    expect(result).toMatchObject({
      status: 'conflict',
      code: 'stale_entity',
      revision: 2,
      folders: [{ name: 'Concurrent', version: 2 }],
    });
    expect((await service.getSnapshot()).folders).toContainEqual(
      expect.objectContaining({ name: 'Concurrent', version: 2 }),
    );
  });

  it('reorders independent sequences and moves Folder subtrees and Bookmarks at explicit positions', async () => {
    const folderA = '81000000-0000-4000-8000-000000000001';
    const folderB = '81000000-0000-4000-8000-000000000002';
    const destination = '81000000-0000-4000-8000-000000000003';
    const destinationChild = '81000000-0000-4000-8000-000000000004';
    const bookmarkA = '82000000-0000-4000-8000-000000000001';
    const bookmarkB = '82000000-0000-4000-8000-000000000002';
    const destinationBookmark = '82000000-0000-4000-8000-000000000003';
    await database.batch([
      ...[
        [folderA, 'A', 'a'],
        [folderB, 'B', 'b'],
        [destination, 'Destination', 'c'],
      ].flatMap(([id, name, rank]) => [
        database
          .prepare(
            `INSERT INTO bookmark_folders
              (id, name, parent_id, rank, created_at, modified_at, version)
             VALUES (?, ?, ?, ?, ?, ?, 1)`,
          )
          .bind(id, name, SYSTEM_ROOT_FOLDER_ID, rank, now, now),
        database
          .prepare(
            "INSERT INTO bookmark_sequences (folder_id, kind, version) VALUES (?, 'folders', 1)",
          )
          .bind(id),
        database
          .prepare(
            "INSERT INTO bookmark_sequences (folder_id, kind, version) VALUES (?, 'bookmarks', 1)",
          )
          .bind(id),
      ]),
      database
        .prepare(
          `INSERT INTO bookmark_folders
            (id, name, parent_id, rank, created_at, modified_at, version)
           VALUES (?, 'Destination Child', ?, 'a', ?, ?, 1)`,
        )
        .bind(destinationChild, destination, now, now),
      database
        .prepare(
          "INSERT INTO bookmark_sequences (folder_id, kind, version) VALUES (?, 'folders', 1)",
        )
        .bind(destinationChild),
      database
        .prepare(
          "INSERT INTO bookmark_sequences (folder_id, kind, version) VALUES (?, 'bookmarks', 1)",
        )
        .bind(destinationChild),
      ...[
        [bookmarkA, SYSTEM_ROOT_FOLDER_ID, 'A Bookmark', 'a'],
        [bookmarkB, SYSTEM_ROOT_FOLDER_ID, 'B Bookmark', 'b'],
        [destinationBookmark, destination, 'Destination Bookmark', 'a'],
      ].map(([id, folderId, title, rank]) =>
        database
          .prepare(
            `INSERT INTO bookmarks
              (id, folder_id, url, title, note, rank, created_at, modified_at, version)
             VALUES (?, ?, 'https://example.com', ?, '', ?, ?, ?, 1)`,
          )
          .bind(id, folderId, title, rank, now, now),
      ),
    ]);
    const service = createBookmarkService(database, { now: () => new Date(now) });

    await service.executeCommand({
      type: 'reorderFolder',
      operationId: 'b0000000-0000-4000-8000-000000000001',
      folderId: folderB,
      folderVersion: 1,
      parentId: SYSTEM_ROOT_FOLDER_ID,
      expectedFolderSequenceVersion: 1,
      beforeFolderId: folderA,
    });
    await service.executeCommand({
      type: 'moveFolder',
      operationId: 'b0000000-0000-4000-8000-000000000002',
      folderId: folderA,
      folderVersion: 1,
      sourceParentId: SYSTEM_ROOT_FOLDER_ID,
      destinationFolderId: destination,
      expectedSourceFolderSequenceVersion: 2,
      expectedDestinationFolderSequenceVersion: 1,
    });
    const movedBookmark = await service.executeCommand({
      type: 'moveBookmark',
      operationId: 'b0000000-0000-4000-8000-000000000003',
      bookmarkId: bookmarkB,
      bookmarkVersion: 1,
      sourceFolderId: SYSTEM_ROOT_FOLDER_ID,
      destinationFolderId: destination,
      expectedSourceBookmarkSequenceVersion: 1,
      expectedDestinationBookmarkSequenceVersion: 1,
      beforeBookmarkId: destinationBookmark,
    });

    const snapshot = await service.getSnapshot();
    expect(
      snapshot.folders
        .filter((folder) => folder.parentId === SYSTEM_ROOT_FOLDER_ID)
        .map((folder) => folder.name),
    ).toEqual(['B', 'Destination']);
    expect(snapshot.folders.find((folder) => folder.id === folderA)).toMatchObject({
      parentId: destination,
      version: 2,
    });
    expect(
      snapshot.folders
        .filter((folder) => folder.parentId === destination)
        .map((folder) => folder.name),
    ).toEqual(['Destination Child', 'A']);
    expect(
      snapshot.bookmarks
        .filter((bookmark) => bookmark.folderId === destination)
        .map((bookmark) => bookmark.title),
    ).toEqual(['B Bookmark', 'Destination Bookmark']);
    expect(movedBookmark).toMatchObject({
      status: 'acknowledged',
      sequences: [
        { folderId: SYSTEM_ROOT_FOLDER_ID, bookmarkVersion: 2 },
        { folderId: destination, bookmarkVersion: 2 },
      ],
    });
  });

  it('rejects Folder cycles, excessive depth, and destination name conflicts atomically', async () => {
    const ids = Array.from(
      { length: 11 },
      (_, index) => `83000000-0000-4000-8000-${(index + 1).toString().padStart(12, '0')}`,
    );
    const statements: D1PreparedStatement[] = [];
    for (let index = 0; index < ids.length; index += 1) {
      const parentId = index === 0 ? SYSTEM_ROOT_FOLDER_ID : ids[index - 1]!;
      statements.push(
        database
          .prepare(
            `INSERT INTO bookmark_folders
              (id, name, parent_id, rank, created_at, modified_at, version)
             VALUES (?, ?, ?, 'a', ?, ?, 1)`,
          )
          .bind(ids[index], index === 10 ? 'Conflict' : `Level ${index + 1}`, parentId, now, now),
        database
          .prepare(
            "INSERT INTO bookmark_sequences (folder_id, kind, version) VALUES (?, 'folders', 1)",
          )
          .bind(ids[index]),
        database
          .prepare(
            "INSERT INTO bookmark_sequences (folder_id, kind, version) VALUES (?, 'bookmarks', 1)",
          )
          .bind(ids[index]),
      );
    }
    statements.push(
      database
        .prepare(
          `INSERT INTO bookmark_folders (id, name, parent_id, rank, created_at, modified_at, version) VALUES ('83100000-0000-4000-8000-000000000001', 'Movable', ?, 'b', ?, ?, 1)`,
        )
        .bind(SYSTEM_ROOT_FOLDER_ID, now, now),
      database
        .prepare(
          `INSERT INTO bookmark_folders (id, name, parent_id, rank, created_at, modified_at, version) VALUES ('83100000-0000-4000-8000-000000000002', 'Child', '83100000-0000-4000-8000-000000000001', 'a', ?, ?, 1)`,
        )
        .bind(now, now),
      ...['83100000-0000-4000-8000-000000000001', '83100000-0000-4000-8000-000000000002'].flatMap(
        (id) => [
          database
            .prepare(
              "INSERT INTO bookmark_sequences (folder_id, kind, version) VALUES (?, 'folders', 1)",
            )
            .bind(id),
          database
            .prepare(
              "INSERT INTO bookmark_sequences (folder_id, kind, version) VALUES (?, 'bookmarks', 1)",
            )
            .bind(id),
        ],
      ),
    );
    await database.batch(statements);
    const service = createBookmarkService(database, { now: () => new Date(now) });

    const cycle = await service.executeCommand({
      type: 'moveFolder',
      operationId: 'b1000000-0000-4000-8000-000000000001',
      folderId: ids[0]!,
      folderVersion: 1,
      sourceParentId: SYSTEM_ROOT_FOLDER_ID,
      destinationFolderId: ids[1]!,
      expectedSourceFolderSequenceVersion: 1,
      expectedDestinationFolderSequenceVersion: 1,
    });
    const depth = await service.executeCommand({
      type: 'moveFolder',
      operationId: 'b1000000-0000-4000-8000-000000000002',
      folderId: '83100000-0000-4000-8000-000000000001',
      folderVersion: 1,
      sourceParentId: SYSTEM_ROOT_FOLDER_ID,
      destinationFolderId: ids[8]!,
      expectedSourceFolderSequenceVersion: 1,
      expectedDestinationFolderSequenceVersion: 1,
    });
    await database
      .prepare(
        `INSERT INTO bookmark_folders
          (id, name, parent_id, rank, created_at, modified_at, version)
         VALUES ('84000000-0000-4000-8000-000000000001', 'Conflict', ?, 'z', ?, ?, 1)`,
      )
      .bind(SYSTEM_ROOT_FOLDER_ID, now, now)
      .run();
    const nameConflict = await service.executeCommand({
      type: 'moveFolder',
      operationId: 'b1000000-0000-4000-8000-000000000003',
      folderId: ids[10]!,
      folderVersion: 1,
      sourceParentId: ids[9]!,
      destinationFolderId: SYSTEM_ROOT_FOLDER_ID,
      expectedSourceFolderSequenceVersion: 1,
      expectedDestinationFolderSequenceVersion: 1,
    });

    expect(cycle).toMatchObject({ status: 'conflict', code: 'folder_cycle' });
    expect(depth).toMatchObject({ status: 'conflict', code: 'folder_depth' });
    expect(nameConflict).toMatchObject({ status: 'conflict', code: 'name_conflict' });
    expect((await service.getSnapshot()).revision).toBe(0);
  });

  it('rejects stale organization versions and rebalances exhausted rank space without visible reorder', async () => {
    const first = '85000000-0000-4000-8000-000000000001';
    const second = '85000000-0000-4000-8000-000000000002';
    await database.batch([
      ...[
        [first, 'First', '0'],
        [second, 'Second', '1'],
      ].flatMap(([id, name, rank]) => [
        database
          .prepare(
            `INSERT INTO bookmark_folders (id, name, parent_id, rank, created_at, modified_at, version) VALUES (?, ?, ?, ?, ?, ?, 1)`,
          )
          .bind(id, name, SYSTEM_ROOT_FOLDER_ID, rank, now, now),
        database
          .prepare(
            "INSERT INTO bookmark_sequences (folder_id, kind, version) VALUES (?, 'folders', 1)",
          )
          .bind(id),
        database
          .prepare(
            "INSERT INTO bookmark_sequences (folder_id, kind, version) VALUES (?, 'bookmarks', 1)",
          )
          .bind(id),
      ]),
      database
        .prepare(
          "UPDATE bookmark_sequences SET version = 4 WHERE folder_id = ? AND kind = 'folders'",
        )
        .bind(SYSTEM_ROOT_FOLDER_ID),
    ]);
    const service = createBookmarkService(database, { now: () => new Date(now) });
    const staleEntity = await service.executeCommand({
      type: 'reorderFolder',
      operationId: 'b2000000-0000-4000-8000-000000000000',
      folderId: second,
      folderVersion: 99,
      parentId: SYSTEM_ROOT_FOLDER_ID,
      expectedFolderSequenceVersion: 4,
      beforeFolderId: first,
    });
    const stale = await service.executeCommand({
      type: 'reorderFolder',
      operationId: 'b2000000-0000-4000-8000-000000000001',
      folderId: second,
      folderVersion: 1,
      parentId: SYSTEM_ROOT_FOLDER_ID,
      expectedFolderSequenceVersion: 3,
      beforeFolderId: first,
    });
    const reordered = await service.executeCommand({
      type: 'reorderFolder',
      operationId: 'b2000000-0000-4000-8000-000000000002',
      folderId: second,
      folderVersion: 1,
      parentId: SYSTEM_ROOT_FOLDER_ID,
      expectedFolderSequenceVersion: 4,
      beforeFolderId: first,
    });
    const snapshot = await service.getSnapshot();

    expect(staleEntity).toMatchObject({ status: 'conflict', code: 'stale_entity', revision: 0 });
    expect(stale).toMatchObject({ status: 'conflict', code: 'stale_sequence', revision: 0 });
    expect(reordered).toMatchObject({
      status: 'acknowledged',
      folders: [{ id: second }, { id: first }],
    });
    expect(
      snapshot.folders
        .filter((folder) => folder.parentId === SYSTEM_ROOT_FOLDER_ID)
        .map((folder) => folder.name),
    ).toEqual(['Second', 'First']);
    expect(
      new Set(
        snapshot.folders
          .filter((folder) => [first, second].includes(folder.id))
          .map((folder) => folder.rank),
      ).size,
    ).toBe(2);
  });
});
