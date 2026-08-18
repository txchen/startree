import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';

import { SYSTEM_ROOT_FOLDER_ID, type BookmarkSnapshot } from '../../shared/bookmarks/contracts';
import { createFetchBookmarkAdapter, createIndexedDbBookmarkAdapter } from './bookmark-adapters';

const snapshot = (revision: number): BookmarkSnapshot => ({
  wireFormatVersion: 1,
  revision,
  folders: [
    {
      id: SYSTEM_ROOT_FOLDER_ID,
      name: '',
      parentId: null,
      rank: '0',
      createdAt: '1970-01-01T00:00:00.000Z',
      modifiedAt: '1970-01-01T00:00:00.000Z',
      version: 1,
    },
  ],
  bookmarks: [],
  tags: [],
  sequences: [{ folderId: SYSTEM_ROOT_FOLDER_ID, folderVersion: 1, bookmarkVersion: 1 }],
});

describe('production Bookmark adapters', () => {
  it('Fetch Adapter conditionally loads and validates snapshots', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(snapshot(4), { headers: { ETag: '"bookmarks-1-4"' } }));
    const adapter = createFetchBookmarkAdapter(fetcher);

    await expect(adapter.readSnapshot(3)).resolves.toEqual(snapshot(4));
    expect(fetcher).toHaveBeenCalledWith('/api/bookmarks/snapshot', {
      headers: { 'If-None-Match': '"bookmarks-1-3"' },
    });

    fetcher.mockResolvedValueOnce(new Response(null, { status: 304 }));
    await expect(adapter.readSnapshot(4)).resolves.toBeNull();
  });

  it('Fetch Adapter rejects an invalid complete snapshot', async () => {
    const adapter = createFetchBookmarkAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ revision: 4 })),
    );

    await expect(adapter.readSnapshot(null)).rejects.toThrow();
  });

  it('IndexedDB Adapter atomically promotes snapshots and retains navigation', async () => {
    const adapter = createIndexedDbBookmarkAdapter(new IDBFactory(), 'startree-test');

    await adapter.writeSnapshot(snapshot(1));
    await adapter.writeNavigation({
      selectedFolderId: SYSTEM_ROOT_FOLDER_ID,
      expandedFolderIds: ['10000000-0000-4000-8000-000000000001'],
    });
    await adapter.writeSnapshot(snapshot(2));

    await expect(adapter.readSnapshot()).resolves.toEqual(snapshot(2));
    await expect(adapter.readNavigation()).resolves.toEqual({
      selectedFolderId: SYSTEM_ROOT_FOLDER_ID,
      expandedFolderIds: ['10000000-0000-4000-8000-000000000001'],
    });
  });
});
