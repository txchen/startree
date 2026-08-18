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
    const migration = await readFile('migrations/0001_initial_bookmark_schema.sql', 'utf8');
    for (const statement of migration
      .split(';')
      .map((sql) => sql.trim())
      .filter(Boolean)) {
      await database.prepare(statement).run();
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
});
