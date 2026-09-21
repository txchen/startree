import { readFileSync, readdirSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SYSTEM_ROOT_FOLDER_ID, type BookmarkCommand } from '../../shared/bookmarks/contracts';
import { createBookmarkService } from './bookmark-service';
import { SqliteBookmarkDatabase } from './sqlite-bookmark-database.test-support';

describe('Pinned Bookmarks', () => {
  let database: SqliteBookmarkDatabase;
  let service: ReturnType<typeof createBookmarkService>;
  let ids: string[];
  let folderId: string;

  beforeEach(async () => {
    database = new SqliteBookmarkDatabase();
    const directory = new URL('../../../migrations/', import.meta.url);
    for (const name of readdirSync(directory)
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      database.exec(readFileSync(new URL(name, directory), 'utf8'));
    }
    service = createBookmarkService(database);
    const folder = await service.executeCommand({
      type: 'createFolder',
      operationId: crypto.randomUUID(),
      parentId: SYSTEM_ROOT_FOLDER_ID,
      expectedFolderSequenceVersion: 1,
      name: 'Reading',
    });
    folderId = folder.folders[0]!.id;
    ids = [];
    for (let index = 0; index < 3; index++) {
      const result = await service.executeCommand({
        type: 'createBookmark',
        operationId: crypto.randomUUID(),
        folderId,
        expectedBookmarkSequenceVersion: index + 1,
        url: `https://example.com/${index}`,
        title: `Bookmark ${index}`,
        note: 'Keep this note',
        tags: ['Reference'],
      });
      ids.push(result.bookmarks[0]!.id);
    }
  });

  afterEach(() => database.close());

  const pin = async (index: number, pinned = true, beforeBookmarkId?: string) =>
    service.executeCommand({
      type: 'setBookmarkPin',
      operationId: crypto.randomUUID(),
      bookmarkId: ids[index]!,
      pinned,
      expectedRevision: (await service.getSnapshot()).revision,
      ...(beforeBookmarkId ? { beforeBookmarkId } : {}),
    });

  const pinnedIds = async () =>
    (await service.getSnapshot()).bookmarks
      .filter((bookmark) => bookmark.pinRank)
      .sort((a, b) =>
        a.pinRank! < b.pinRank! ? -1 : a.pinRank! > b.pinRank! ? 1 : a.id.localeCompare(b.id),
      )
      .map((bookmark) => bookmark.id);

  it('pins, reorders, and unpins without changing Bookmark content or Folder ordering', async () => {
    const initial = await service.getSnapshot();
    const first = await pin(0);
    expect(first.status).toBe('acknowledged');
    expect(first.tags).toEqual([{ bookmarkId: ids[0], value: 'Reference' }]);
    await pin(1);
    await pin(2);
    expect(await pinnedIds()).toEqual(ids);
    await pin(2, true, ids[0]);
    expect(await pinnedIds()).toEqual([ids[2], ids[0], ids[1]]);
    await pin(2);
    expect(await pinnedIds()).toEqual(ids);
    await pin(1, false);
    expect(await pinnedIds()).toEqual([ids[0], ids[2]]);
    const after = await service.getSnapshot();
    expect(after.bookmarks.map(({ pinRank: _pinRank, ...bookmark }) => bookmark)).toEqual(
      initial.bookmarks.map(({ pinRank: _pinRank, ...bookmark }) => bookmark),
    );
    expect(after.sequences).toEqual(initial.sequences);
    expect(after.tags).toEqual(initial.tags);
  });

  it('preserves pins through edits, Folder trash and restore, and removes them on permanent deletion', async () => {
    await pin(0);
    const originalRank = (await service.getSnapshot()).bookmarks[0]!.pinRank;
    await service.executeCommand({
      type: 'editBookmark',
      operationId: crypto.randomUUID(),
      bookmarkId: ids[0]!,
      bookmarkVersion: 1,
      url: 'https://example.com/updated',
      title: 'Updated',
      note: 'Updated note',
      tags: ['Updated'],
    });
    expect((await service.getSnapshot()).bookmarks[0]).toMatchObject({
      title: 'Updated',
      url: 'https://example.com/updated',
      pinRank: originalRank,
    });
    await service.executeCommand({
      type: 'trashFolder',
      operationId: crypto.randomUUID(),
      folderId,
      folderVersion: 1,
      parentId: SYSTEM_ROOT_FOLDER_ID,
      expectedFolderSequenceVersion: 2,
    });
    expect(await pinnedIds()).toEqual([]);
    const trashed = await service.getTrash();
    const rootVersion = trashed.folders.find((folder) => folder.id === folderId)!.version;
    expect(trashed.bookmarks.find((bookmark) => bookmark.id === ids[0])?.pinRank).toBe(
      originalRank,
    );
    const restored = await service.executeCommand({
      type: 'restoreTrash',
      operationId: crypto.randomUUID(),
      rootKind: 'folder',
      rootId: folderId,
      rootVersion,
      expectedDestinationSequenceVersion: 3,
    });
    expect(restored.status).toBe('acknowledged');
    expect(await pinnedIds()).toEqual([ids[0]]);
    const current = (await service.getSnapshot()).bookmarks.find(
      (bookmark) => bookmark.id === ids[0],
    )!;
    const sequence = (await service.getSnapshot()).sequences.find(
      (item) => item.folderId === folderId,
    )!;
    await service.executeCommand({
      type: 'trashBookmark',
      operationId: crypto.randomUUID(),
      bookmarkId: current.id,
      bookmarkVersion: current.version,
      folderId,
      expectedBookmarkSequenceVersion: sequence.bookmarkVersion,
    });
    const trash = await service.getTrash();
    await service.executeCommand({
      type: 'purgeTrash',
      operationId: crypto.randomUUID(),
      rootKind: 'bookmark',
      rootId: current.id,
      rootVersion: trash.bookmarks.find((bookmark) => bookmark.id === current.id)!.version,
    });
    expect(
      await database.prepare('SELECT id FROM bookmarks WHERE id = ?').bind(current.id).first(),
    ).toBeNull();
  });

  it('rejects stale writes and invalid destinations, and replays a settled operation exactly', async () => {
    const command: BookmarkCommand = {
      type: 'setBookmarkPin',
      operationId: crypto.randomUUID(),
      bookmarkId: ids[0]!,
      pinned: true,
      expectedRevision: (await service.getSnapshot()).revision,
    };
    const result = await service.executeCommand(command);
    await pin(1);
    expect(await service.executeCommand(command)).toEqual(result);
    expect(
      await service.executeCommand({ ...command, operationId: crypto.randomUUID() }),
    ).toMatchObject({ status: 'conflict', code: 'stale_sequence' });
    expect(await pin(0, true, ids[2])).toMatchObject({
      status: 'conflict',
      code: 'invalid_position',
    });
    expect(await pin(0, true, ids[0])).toMatchObject({
      status: 'conflict',
      code: 'invalid_position',
    });
    expect(await pin(0, false, ids[1])).toMatchObject({
      status: 'conflict',
      code: 'invalid_position',
    });
    expect(await pinnedIds()).toEqual([ids[0], ids[1]]);
  });

  it('rolls back a pin when another command wins between reading and committing', async () => {
    const racing = createBookmarkService(database, {
      beforeCommandBatch: async () => {
        await pin(1);
      },
    });
    const result = await racing.executeCommand({
      type: 'setBookmarkPin',
      operationId: crypto.randomUUID(),
      bookmarkId: ids[0]!,
      pinned: true,
      expectedRevision: (await service.getSnapshot()).revision,
    });
    expect(result).toMatchObject({ status: 'conflict', code: 'stale_sequence' });
    expect(await pinnedIds()).toEqual([ids[1]]);
  });

  it('rebalances exhausted pin ranks without touching Folder ranks', async () => {
    await database
      .prepare('UPDATE bookmarks SET pin_rank = ? WHERE id = ?')
      .bind('0', ids[0])
      .all();
    const before = await service.getSnapshot();
    expect(await pin(1, true, ids[0])).toMatchObject({ status: 'acknowledged' });
    expect(await pinnedIds()).toEqual([ids[1], ids[0]]);
    expect((await service.getSnapshot()).bookmarks.map((bookmark) => bookmark.rank)).toEqual(
      before.bookmarks.map((bookmark) => bookmark.rank),
    );
  });
});
