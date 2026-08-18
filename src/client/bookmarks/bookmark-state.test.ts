import { describe, expect, it } from 'vitest';

import { SYSTEM_ROOT_FOLDER_ID, type BookmarkSnapshot } from '../../shared/bookmarks/contracts';
import { createBookmarkState } from './bookmark-state';
import {
  createMemoryBookmarkRemoteAdapter,
  createMemoryBookmarkStorageAdapter,
} from './bookmark-state.test-helpers';

const folderId = '10000000-0000-4000-8000-000000000001';
const childAId = '10000000-0000-4000-8000-000000000002';
const childBId = '10000000-0000-4000-8000-000000000003';

const snapshot = (revision = 1): BookmarkSnapshot => ({
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
    {
      id: folderId,
      name: 'Reading',
      parentId: SYSTEM_ROOT_FOLDER_ID,
      rank: 'a',
      createdAt: '2026-08-18T00:00:00.000Z',
      modifiedAt: '2026-08-18T00:00:00.000Z',
      version: 1,
    },
    {
      id: childBId,
      name: 'Later',
      parentId: folderId,
      rank: 'b',
      createdAt: '2026-08-18T00:00:00.000Z',
      modifiedAt: '2026-08-18T00:00:00.000Z',
      version: 1,
    },
    {
      id: childAId,
      name: 'Now',
      parentId: folderId,
      rank: 'a',
      createdAt: '2026-08-18T00:00:00.000Z',
      modifiedAt: '2026-08-18T00:00:00.000Z',
      version: 1,
    },
  ],
  bookmarks: [
    {
      id: '20000000-0000-4000-8000-000000000002',
      folderId,
      url: 'https://example.org/later',
      title: 'Later Bookmark',
      note: '',
      rank: 'b',
      createdAt: '2026-08-18T00:00:00.000Z',
      modifiedAt: '2026-08-18T00:00:00.000Z',
      version: 1,
    },
    {
      id: '20000000-0000-4000-8000-000000000001',
      folderId,
      url: 'https://example.com/now',
      title: 'Now Bookmark',
      note: 'Read this soon',
      rank: 'a',
      createdAt: '2026-08-18T00:00:00.000Z',
      modifiedAt: '2026-08-18T00:00:00.000Z',
      version: 1,
    },
  ],
  tags: [{ bookmarkId: '20000000-0000-4000-8000-000000000001', value: 'Reference' }],
  sequences: [
    { folderId: SYSTEM_ROOT_FOLDER_ID, folderVersion: 1, bookmarkVersion: 1 },
    { folderId, folderVersion: 1, bookmarkVersion: 1 },
    { folderId: childAId, folderVersion: 1, bookmarkVersion: 1 },
    { folderId: childBId, folderVersion: 1, bookmarkVersion: 1 },
  ],
});

describe('Bookmark state Module Interface', () => {
  it('initializes from adapters and exposes only direct children in independent order', async () => {
    const remote = createMemoryBookmarkRemoteAdapter(snapshot());
    const storage = createMemoryBookmarkStorageAdapter();
    const state = createBookmarkState({ remote, storage });

    await state.initialize({ folderId });

    expect(state.getState()).toMatchObject({
      status: 'ready',
      selectedFolder: { id: folderId, name: 'Reading' },
      breadcrumbs: [
        { id: SYSTEM_ROOT_FOLDER_ID, name: 'Bookmarks' },
        { id: folderId, name: 'Reading' },
      ],
    });
    expect(state.getState().directFolders.map((folder) => folder.name)).toEqual(['Now', 'Later']);
    expect(state.getState().directBookmarks.map((bookmark) => bookmark.title)).toEqual([
      'Now Bookmark',
      'Later Bookmark',
    ]);
    expect(state.getState().tagsByBookmark['20000000-0000-4000-8000-000000000001']).toEqual([
      'Reference',
    ]);
    expect(await storage.readSnapshot()).toEqual(snapshot());
  });

  it('restores remembered navigation and expanded state locally', async () => {
    const storage = createMemoryBookmarkStorageAdapter({
      snapshot: snapshot(),
      navigation: { selectedFolderId: folderId, expandedFolderIds: [folderId] },
    });
    const state = createBookmarkState({
      remote: createMemoryBookmarkRemoteAdapter(snapshot()),
      storage,
    });

    await state.initialize();
    await state.toggleFolderExpanded(childAId);

    expect(state.getState().selectedFolder?.id).toBe(folderId);
    expect(state.getState().expandedFolderIds).toEqual([folderId, childAId]);
    expect(await storage.readNavigation()).toEqual({
      selectedFolderId: folderId,
      expandedFolderIds: [folderId, childAId],
    });
  });

  it('falls back to root when remembered navigation is missing from the settled snapshot', async () => {
    const storage = createMemoryBookmarkStorageAdapter({
      snapshot: snapshot(),
      navigation: {
        selectedFolderId: '90000000-0000-4000-8000-000000000001',
        expandedFolderIds: [],
      },
    });
    const state = createBookmarkState({
      remote: createMemoryBookmarkRemoteAdapter(snapshot()),
      storage,
    });

    await state.initialize();

    expect(state.getState()).toMatchObject({
      selectedFolder: { id: SYSTEM_ROOT_FOLDER_ID },
      notice: 'The remembered Folder is no longer available. Showing Bookmarks instead.',
    });
  });

  it('exposes Not Found for an explicit missing Folder route', async () => {
    const state = createBookmarkState({
      remote: createMemoryBookmarkRemoteAdapter(snapshot()),
      storage: createMemoryBookmarkStorageAdapter(),
    });

    await state.initialize({ folderId: '90000000-0000-4000-8000-000000000001' });

    expect(state.getState()).toMatchObject({ status: 'not-found', selectedFolder: null });
  });

  it('exposes Not Found when browser navigation reaches a missing Folder', async () => {
    const state = createBookmarkState({
      remote: createMemoryBookmarkRemoteAdapter(snapshot()),
      storage: createMemoryBookmarkStorageAdapter(),
    });
    await state.initialize({ folderId });

    await state.selectFolder('90000000-0000-4000-8000-000000000001');

    expect(state.getState()).toMatchObject({ status: 'not-found', selectedFolder: null });
  });

  it('conditionally refreshes and falls back if the selected Folder was deleted', async () => {
    const remote = createMemoryBookmarkRemoteAdapter(snapshot());
    const state = createBookmarkState({ remote, storage: createMemoryBookmarkStorageAdapter() });
    await state.initialize({ folderId });
    remote.setSnapshot({
      ...snapshot(2),
      folders: snapshot(2).folders.filter((folder) => folder.id === SYSTEM_ROOT_FOLDER_ID),
      bookmarks: [],
      tags: [],
      sequences: snapshot(2).sequences.filter(
        (sequence) => sequence.folderId === SYSTEM_ROOT_FOLDER_ID,
      ),
    });

    await state.refresh();

    expect(state.getState()).toMatchObject({
      selectedFolder: { id: SYSTEM_ROOT_FOLDER_ID },
      notice: 'The selected Folder is no longer available. Showing Bookmarks instead.',
    });
    expect(remote.requestedRevisions).toEqual([null, 1]);
  });
});
