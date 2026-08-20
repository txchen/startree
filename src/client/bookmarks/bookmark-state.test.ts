import { afterEach, describe, expect, it, vi } from 'vitest';

import { SYSTEM_ROOT_FOLDER_ID, type BookmarkSnapshot } from '../../shared/bookmarks/contracts';
import { createBookmarkState } from './bookmark-state';
import { createMiniSearchBookmarkAdapter } from './bookmark-search';
import { UnknownBookmarkCommandError } from './bookmark-adapters';
import {
  createMemoryBookmarkLifecycleAdapter,
  createMemoryBookmarkRemoteAdapter,
  createMemoryBookmarkStorageAdapter,
} from './bookmark-state.test-helpers';

afterEach(() => {
  vi.useRealTimers();
});

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
  it('removes a trashed Bookmark optimistically and loads Trash only while online', async () => {
    const remote = createMemoryBookmarkRemoteAdapter(snapshot());
    const bookmark = snapshot().bookmarks[1]!;
    remote.setTrash({
      wireFormatVersion: 1,
      revision: 2,
      roots: [
        {
          kind: 'bookmark',
          id: bookmark.id,
          deletedAt: '2026-08-18T01:00:00.000Z',
          originalParentId: folderId,
          originalRank: 'a',
        },
      ],
      folders: [],
      bookmarks: [{ ...bookmark, version: 2 }],
      tags: [{ bookmarkId: bookmark.id, value: 'Reference' }],
    });
    remote.executeCommand = async (command) => ({
      status: 'acknowledged',
      operationId: command.operationId,
      revision: 2,
      folders: [],
      bookmarks: [],
      tags: [],
      sequences: [{ folderId, folderVersion: 1, bookmarkVersion: 2 }],
      deletedBookmarkIds: [bookmark.id],
    });
    const lifecycle = createMemoryBookmarkLifecycleAdapter();
    const search = createMiniSearchBookmarkAdapter();
    const state = createBookmarkState({
      remote,
      storage: createMemoryBookmarkStorageAdapter(),
      lifecycle,
      search,
    });
    await state.initialize({ folderId });

    await state.executeCommand({
      type: 'trashBookmark',
      operationId: 'ad000000-0000-4000-8000-000000000001',
      bookmarkId: bookmark.id,
      bookmarkVersion: 1,
      folderId,
      expectedBookmarkSequenceVersion: 1,
    });

    expect(state.getState().directBookmarks.map((item) => item.id)).not.toContain(bookmark.id);
    await state.search('Now Bookmark');
    expect(state.getState().searchResults.map((result) => result.id)).not.toContain(bookmark.id);
    expect(state.getState().trash?.roots).toEqual([expect.objectContaining({ id: bookmark.id })]);
    lifecycle.setOnline(false);
    await state.loadTrash();
    expect(state.getState()).toMatchObject({ trash: null, trashStatus: 'offline' });
    state.dispose();
  });

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
    expect(await storage.readSnapshot()).toMatchObject({
      status: 'compatible',
      snapshot: snapshot(),
    });
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

  it('renders a compatible retained snapshot before its background refresh settles', async () => {
    let resolveRefresh: ((value: BookmarkSnapshot | null) => void) | undefined;
    const remote = {
      readSnapshot: () =>
        new Promise<BookmarkSnapshot | null>((resolve) => {
          resolveRefresh = resolve;
        }),
    };
    const state = createBookmarkState({
      remote,
      storage: createMemoryBookmarkStorageAdapter({
        snapshot: snapshot(),
        synchronizedAt: '2026-08-18T20:00:00.000Z',
      }),
      lifecycle: createMemoryBookmarkLifecycleAdapter(),
    });

    const initialization = state.initialize({ folderId });
    await vi.waitFor(() => expect(state.getState().status).toBe('ready'));

    expect(state.getState()).toMatchObject({
      selectedFolder: { id: folderId },
      lastSuccessfulSyncAt: '2026-08-18T20:00:00.000Z',
      syncStatus: 'idle',
    });
    resolveRefresh?.(null);
    await initialization;
    state.dispose();
  });

  it('shows syncing after two seconds and a slow state after five while retaining content', async () => {
    vi.useFakeTimers();
    const lifecycle = createMemoryBookmarkLifecycleAdapter();
    const remote = { readSnapshot: () => new Promise<BookmarkSnapshot | null>(() => undefined) };
    const state = createBookmarkState({
      remote,
      storage: createMemoryBookmarkStorageAdapter({ snapshot: snapshot() }),
      lifecycle,
    });

    void state.initialize();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.getState().status).toBe('ready');
    expect(state.getState().syncStatus).toBe('idle');

    await vi.advanceTimersByTimeAsync(2_000);
    expect(state.getState().syncStatus).toBe('syncing');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(state.getState().syncStatus).toBe('slow');
    expect(state.getState().folders).toHaveLength(snapshot().folders.length);
    state.dispose();
  });

  it('delays cold-load progress until two and a half seconds without a retained snapshot', async () => {
    vi.useFakeTimers();
    const state = createBookmarkState({
      remote: { readSnapshot: () => new Promise<BookmarkSnapshot | null>(() => undefined) },
      storage: createMemoryBookmarkStorageAdapter(),
      lifecycle: createMemoryBookmarkLifecycleAdapter(),
    });

    void state.initialize();
    await vi.advanceTimersByTimeAsync(2_499);
    expect(state.getState()).toMatchObject({
      status: 'loading',
      coldLoadProgressVisible: false,
    });

    await vi.advanceTimersByTimeAsync(1);
    expect(state.getState()).toMatchObject({
      status: 'loading',
      coldLoadProgressVisible: true,
    });
    state.dispose();
  });

  it('retains usable content and its synchronization time after a refresh failure', async () => {
    const state = createBookmarkState({
      remote: { readSnapshot: () => Promise.reject(new Error('offline')) },
      storage: createMemoryBookmarkStorageAdapter({
        snapshot: snapshot(),
        synchronizedAt: '2026-08-18T20:00:00.000Z',
      }),
      lifecycle: createMemoryBookmarkLifecycleAdapter(),
    });

    await state.initialize();

    expect(state.getState()).toMatchObject({
      status: 'ready',
      syncStatus: 'failed',
      lastSuccessfulSyncAt: '2026-08-18T20:00:00.000Z',
    });
    expect(state.getState().folders).toHaveLength(snapshot().folders.length);
    state.dispose();
  });

  it('queues a retry requested while a slow refresh is finishing its abort', async () => {
    vi.useFakeTimers();
    let requests = 0;
    const state = createBookmarkState({
      remote: {
        readSnapshot(_revision, signal) {
          requests += 1;
          if (requests > 1) return Promise.resolve(null);
          return new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('slow')), { once: true });
          });
        },
      },
      storage: createMemoryBookmarkStorageAdapter({ snapshot: snapshot() }),
      lifecycle: createMemoryBookmarkLifecycleAdapter(),
    });

    let retry: Promise<void> | undefined;
    const unsubscribe = state.subscribe((view) => {
      if (view.syncStatus === 'slow' && !retry) retry = state.refresh();
    });
    const initialization = state.initialize();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(retry).toBeDefined();

    await Promise.all([initialization, retry]);

    expect(requests).toBe(2);
    expect(state.getState().syncStatus).toBe('idle');
    unsubscribe();
    state.dispose();
  });

  it('does not interpret an incompatible retained snapshot while offline', async () => {
    const remote = { readSnapshot: vi.fn(() => Promise.resolve(null)) };
    const state = createBookmarkState({
      remote,
      storage: createMemoryBookmarkStorageAdapter({ incompatibleWireFormatVersion: 99 }),
      lifecycle: createMemoryBookmarkLifecycleAdapter({ online: false }),
    });

    await state.initialize();

    expect(state.getState()).toMatchObject({
      status: 'error',
      syncStatus: 'offline',
      retainedSnapshotCompatibility: 'incompatible',
    });
    expect(remote.readSnapshot).not.toHaveBeenCalled();
    state.dispose();
  });

  it('refreshes on reconnection and a visibility return without polling while visible', async () => {
    vi.useFakeTimers();
    const lifecycle = createMemoryBookmarkLifecycleAdapter();
    const remote = createMemoryBookmarkRemoteAdapter(snapshot());
    const state = createBookmarkState({
      remote,
      storage: createMemoryBookmarkStorageAdapter(),
      lifecycle,
    });
    await state.initialize();
    expect(remote.requestedRevisions).toEqual([null]);

    lifecycle.setOnline(false);
    lifecycle.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(remote.requestedRevisions).toEqual([null, 1]);

    lifecycle.setVisible(false);
    await vi.advanceTimersByTimeAsync(60_000);
    lifecycle.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(remote.requestedRevisions).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(remote.requestedRevisions).toHaveLength(3);
    state.dispose();
  });

  it('provides an authoritative mutation completion refresh hook', async () => {
    const remote = createMemoryBookmarkRemoteAdapter(snapshot());
    const state = createBookmarkState({
      remote,
      storage: createMemoryBookmarkStorageAdapter(),
      lifecycle: createMemoryBookmarkLifecycleAdapter(),
    });
    await state.initialize();

    await state.refreshAfterMutation();

    expect(remote.requestedRevisions).toEqual([null, 1]);
    state.dispose();
  });

  it('searches the active snapshot through the state Module Interface', async () => {
    const state = createBookmarkState({
      remote: createMemoryBookmarkRemoteAdapter(snapshot()),
      storage: createMemoryBookmarkStorageAdapter(),
      lifecycle: createMemoryBookmarkLifecycleAdapter(),
      search: createMiniSearchBookmarkAdapter(),
    });
    await state.initialize();

    await state.search('soon');

    expect(state.getState().searchResults).toMatchObject([
      {
        kind: 'bookmark',
        id: '20000000-0000-4000-8000-000000000001',
        folderPath: 'Bookmarks / Reading',
      },
    ]);
    state.dispose();
  });

  it('defaults to global search and follows the selected Folder when scoped locally', async () => {
    const state = createBookmarkState({
      remote: createMemoryBookmarkRemoteAdapter(snapshot()),
      storage: createMemoryBookmarkStorageAdapter(),
      lifecycle: createMemoryBookmarkLifecycleAdapter(),
      search: createMiniSearchBookmarkAdapter(),
    });
    await state.initialize({ folderId: childAId });

    expect(state.getState().searchScope).toBe('global');
    await state.search('Later Bookmark');
    expect(state.getState().searchResults.map((result) => result.id)).toContain(
      '20000000-0000-4000-8000-000000000002',
    );

    await state.search('Later Bookmark', undefined, 'selected-folder');
    expect(state.getState()).toMatchObject({ searchScope: 'selected-folder', searchResults: [] });

    await state.selectFolder(folderId);
    expect(state.getState().searchResults).toContainEqual(
      expect.objectContaining({
        kind: 'bookmark',
        id: '20000000-0000-4000-8000-000000000002',
      }),
    );
    state.dispose();
  });

  it('retains active search filters when a replacement snapshot is promoted', async () => {
    const remote = createMemoryBookmarkRemoteAdapter(snapshot());
    const state = createBookmarkState({
      remote,
      storage: createMemoryBookmarkStorageAdapter(),
      lifecycle: createMemoryBookmarkLifecycleAdapter(),
      search: createMiniSearchBookmarkAdapter(),
    });
    await state.initialize();
    await state.search('', { tags: ['Reference'], domains: ['example.com'] });
    expect(state.getState()).toMatchObject({
      searchFilters: { tags: ['Reference'], domains: ['example.com'] },
      searchResults: [{ id: '20000000-0000-4000-8000-000000000001' }],
    });

    remote.setSnapshot({
      ...snapshot(2),
      bookmarks: snapshot(2).bookmarks.filter((bookmark) => bookmark.url.includes('example.org')),
      tags: [],
    });
    await state.refresh();

    expect(state.getState()).toMatchObject({
      searchFilters: { tags: ['Reference'], domains: ['example.com'] },
      searchResults: [],
    });
    state.dispose();
  });

  it('optimistically presents a write immediately and merges its authoritative result', async () => {
    let settle:
      | ((value: import('../../shared/bookmarks/contracts').BookmarkCommandResult) => void)
      | undefined;
    const remote = createMemoryBookmarkRemoteAdapter(snapshot());
    remote.executeCommand = () =>
      new Promise((resolve) => {
        settle = resolve;
      });
    const state = createBookmarkState({
      remote,
      storage: createMemoryBookmarkStorageAdapter(),
      lifecycle: createMemoryBookmarkLifecycleAdapter(),
    });
    await state.initialize({ folderId });
    const command = {
      type: 'createFolder' as const,
      operationId: 'a0000000-0000-4000-8000-000000000001',
      parentId: folderId,
      expectedFolderSequenceVersion: 1,
      name: 'Optimistic',
    };

    const write = state.executeCommand(command);
    expect(state.getState()).toMatchObject({ writeStatus: 'pending' });
    expect(state.getState().directFolders.map((folder) => folder.name)).toContain('Optimistic');
    settle?.({
      status: 'acknowledged',
      operationId: command.operationId,
      revision: 2,
      folders: [
        {
          id: '80000000-0000-4000-8000-000000000001',
          name: 'Optimistic',
          parentId: folderId,
          rank: 'z',
          createdAt: '2026-08-18T12:00:00.000Z',
          modifiedAt: '2026-08-18T12:00:00.000Z',
          version: 1,
        },
      ],
      bookmarks: [],
      tags: [],
      sequences: [{ folderId, folderVersion: 2, bookmarkVersion: 1 }],
    });
    await write;

    expect(state.getState()).toMatchObject({ writeStatus: 'idle', snapshotRevision: 2 });
    expect(state.getState().directFolders).toContainEqual(
      expect.objectContaining({ id: '80000000-0000-4000-8000-000000000001' }),
    );
    state.dispose();
  });

  it('rolls back a failed optimistic write', async () => {
    const remote = createMemoryBookmarkRemoteAdapter(snapshot());
    remote.executeCommand = () => Promise.reject(new Error('rejected'));
    const state = createBookmarkState({
      remote,
      storage: createMemoryBookmarkStorageAdapter(),
      lifecycle: createMemoryBookmarkLifecycleAdapter(),
    });
    await state.initialize({ folderId });

    await state.executeCommand({
      type: 'editFolder',
      operationId: 'a0000000-0000-4000-8000-000000000002',
      folderId,
      folderVersion: 1,
      name: 'Changed',
    });

    expect(state.getState()).toMatchObject({
      writeStatus: 'failed',
      selectedFolder: { name: 'Reading' },
    });
    state.dispose();
  });

  it('optimistically moves a record and rolls back a rejected organization command', async () => {
    let rejectMove: ((reason: Error) => void) | undefined;
    const remote = createMemoryBookmarkRemoteAdapter(snapshot());
    remote.executeCommand = () =>
      new Promise((_resolve, reject) => {
        rejectMove = reject;
      });
    const state = createBookmarkState({
      remote,
      storage: createMemoryBookmarkStorageAdapter(),
      lifecycle: createMemoryBookmarkLifecycleAdapter(),
    });
    await state.initialize({ folderId });

    const move = state.executeCommand({
      type: 'moveBookmark',
      operationId: 'aa000000-0000-4000-8000-000000000001',
      bookmarkId: '20000000-0000-4000-8000-000000000001',
      bookmarkVersion: 1,
      sourceFolderId: folderId,
      destinationFolderId: childAId,
      expectedSourceBookmarkSequenceVersion: 1,
      expectedDestinationBookmarkSequenceVersion: 1,
    });
    expect(state.getState().directBookmarks.map((bookmark) => bookmark.title)).toEqual([
      'Later Bookmark',
    ]);
    rejectMove?.(new Error('rejected'));
    await move;

    expect(state.getState().directBookmarks.map((bookmark) => bookmark.title)).toEqual([
      'Now Bookmark',
      'Later Bookmark',
    ]);
    expect(state.getState().writeStatus).toBe('failed');
    state.dispose();
  });

  it('optimistically reorders records and merges the authoritative organization result', async () => {
    let settle:
      | ((value: import('../../shared/bookmarks/contracts').BookmarkCommandResult) => void)
      | undefined;
    const remote = createMemoryBookmarkRemoteAdapter(snapshot());
    remote.executeCommand = () =>
      new Promise((resolve) => {
        settle = resolve;
      });
    const state = createBookmarkState({
      remote,
      storage: createMemoryBookmarkStorageAdapter(),
      lifecycle: createMemoryBookmarkLifecycleAdapter(),
    });
    await state.initialize({ folderId });
    const command = {
      type: 'reorderFolder' as const,
      operationId: 'aa000000-0000-4000-8000-000000000002',
      folderId: childBId,
      folderVersion: 1,
      parentId: folderId,
      expectedFolderSequenceVersion: 1,
      beforeFolderId: childAId,
    };

    const reorder = state.executeCommand(command);
    expect(state.getState().directFolders.map((folder) => folder.name)).toEqual(['Later', 'Now']);
    settle?.({
      status: 'acknowledged',
      operationId: command.operationId,
      revision: 2,
      folders: [
        { ...snapshot().folders[2]!, rank: 'a', version: 2 },
        { ...snapshot().folders[3]!, rank: 'b' },
      ],
      bookmarks: [],
      tags: [],
      sequences: [{ folderId, folderVersion: 2, bookmarkVersion: 1 }],
    });
    await reorder;

    expect(state.getState()).toMatchObject({ writeStatus: 'idle', snapshotRevision: 2 });
    expect(state.getState().directFolders.map((folder) => folder.name)).toEqual(['Later', 'Now']);
    state.dispose();
  });

  it('conditionally refreshes when another tab announces a newer revision', async () => {
    let receive: ((revision: number) => void) | undefined;
    const remote = createMemoryBookmarkRemoteAdapter(snapshot());
    const revisionChannel = {
      announce: vi.fn(),
      subscribe(listener: (revision: number) => void) {
        receive = listener;
        return () => {
          receive = undefined;
        };
      },
      close: vi.fn(),
    };
    const state = createBookmarkState({
      remote,
      storage: createMemoryBookmarkStorageAdapter(),
      lifecycle: createMemoryBookmarkLifecycleAdapter(),
      revisionChannel,
    });
    await state.initialize({ folderId });
    const replacement = snapshot(2);
    replacement.folders[1] = { ...replacement.folders[1]!, name: 'Cross-tab' };
    remote.setSnapshot(replacement);

    receive?.(1);
    await Promise.resolve();
    expect(remote.requestedRevisions).toEqual([null]);
    receive?.(2);
    await vi.waitFor(() => expect(state.getState().snapshotRevision).toBe(2));

    expect(state.getState().selectedFolder?.name).toBe('Cross-tab');
    state.dispose();
    expect(revisionChannel.close).toHaveBeenCalledOnce();
  });

  it('records unknown outcomes and refreshes before an explicit same-ID retry', async () => {
    const storage = createMemoryBookmarkStorageAdapter();
    const remote = createMemoryBookmarkRemoteAdapter(snapshot());
    const operationIds: string[] = [];
    remote.executeCommand = async (command) => {
      operationIds.push(command.operationId);
      if (operationIds.length === 1) {
        throw new UnknownBookmarkCommandError('lost');
      }
      return {
        status: 'acknowledged',
        operationId: command.operationId,
        revision: 2,
        folders: [],
        bookmarks: [],
        tags: [],
        sequences: [],
      };
    };
    const state = createBookmarkState({
      remote,
      storage,
      lifecycle: createMemoryBookmarkLifecycleAdapter(),
    });
    await state.initialize({ folderId });
    const command = {
      type: 'editFolder' as const,
      operationId: 'a0000000-0000-4000-8000-000000000003',
      folderId,
      folderVersion: 1,
      name: 'Changed',
    };

    await state.executeCommand(command);
    expect(state.getState()).toMatchObject({ writeStatus: 'unknown' });
    expect(await storage.readUnconfirmedOperations?.()).toEqual([
      expect.objectContaining({ command }),
    ]);

    await state.retryUnconfirmed(command.operationId);

    expect(operationIds).toEqual([command.operationId, command.operationId]);
    expect(remote.requestedRevisions).toEqual([null, 1]);
    expect(await storage.readUnconfirmedOperations?.()).toEqual([]);
    state.dispose();
  });

  it('serializes writes so only one command is in flight', async () => {
    const remote = createMemoryBookmarkRemoteAdapter(snapshot());
    let active = 0;
    let maximumActive = 0;
    remote.executeCommand = async (command) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return {
        status: 'acknowledged',
        operationId: command.operationId,
        revision: 2,
        folders: [],
        bookmarks: [],
        tags: [],
        sequences: [],
      };
    };
    const state = createBookmarkState({
      remote,
      storage: createMemoryBookmarkStorageAdapter(),
      lifecycle: createMemoryBookmarkLifecycleAdapter(),
    });
    await state.initialize({ folderId });

    await Promise.all([
      state.executeCommand({
        type: 'editFolder',
        operationId: 'a0000000-0000-4000-8000-000000000004',
        folderId,
        folderVersion: 1,
        name: 'One',
      }),
      state.executeCommand({
        type: 'editFolder',
        operationId: 'a0000000-0000-4000-8000-000000000005',
        folderId,
        folderVersion: 1,
        name: 'Two',
      }),
    ]);

    expect(maximumActive).toBe(1);
    state.dispose();
  });

  it('refreshes the complete snapshot when a conflict reports a revision gap', async () => {
    const remote = createMemoryBookmarkRemoteAdapter(snapshot());
    remote.executeCommand = (command) =>
      Promise.resolve({
        status: 'conflict',
        operationId: command.operationId,
        code: 'stale_entity',
        revision: 3,
        folders: [{ ...snapshot().folders[1]!, name: 'Authoritative', version: 2 }],
        bookmarks: [],
        tags: [],
        sequences: [],
      });
    const authoritative = snapshot(3);
    authoritative.folders[1] = { ...authoritative.folders[1]!, name: 'Authoritative', version: 2 };
    const state = createBookmarkState({
      remote,
      storage: createMemoryBookmarkStorageAdapter(),
      lifecycle: createMemoryBookmarkLifecycleAdapter(),
    });
    await state.initialize({ folderId });
    remote.setSnapshot(authoritative);

    await state.executeCommand({
      type: 'editFolder',
      operationId: 'a0000000-0000-4000-8000-000000000006',
      folderId,
      folderVersion: 1,
      name: 'Stale',
    });

    expect(state.getState()).toMatchObject({
      writeStatus: 'conflict',
      snapshotRevision: 3,
      selectedFolder: { name: 'Authoritative', version: 2 },
    });
    expect(remote.requestedRevisions).toEqual([null, 1]);
    state.dispose();
  });

  it('rejects writes while offline without recording an unconfirmed operation', async () => {
    const lifecycle = createMemoryBookmarkLifecycleAdapter();
    const remote = createMemoryBookmarkRemoteAdapter(snapshot());
    remote.executeCommand = vi.fn();
    const storage = createMemoryBookmarkStorageAdapter();
    const state = createBookmarkState({ remote, storage, lifecycle });
    await state.initialize({ folderId });
    lifecycle.setOnline(false);

    await state.executeCommand({
      type: 'editFolder',
      operationId: 'a0000000-0000-4000-8000-000000000007',
      folderId,
      folderVersion: 1,
      name: 'Offline change',
    });

    expect(remote.executeCommand).not.toHaveBeenCalled();
    expect(state.getState().writeStatus).toBe('failed');
    expect(await storage.readUnconfirmedOperations?.()).toEqual([]);
    state.dispose();
  });

  it('keeps an acknowledged authoritative result when local persistence fails', async () => {
    const remote = createMemoryBookmarkRemoteAdapter(snapshot());
    remote.executeCommand = (command) =>
      Promise.resolve({
        status: 'acknowledged',
        operationId: command.operationId,
        revision: 2,
        folders: [{ ...snapshot().folders[1]!, name: 'Saved remotely', version: 2 }],
        bookmarks: [],
        tags: [],
        sequences: [],
      });
    const storage = createMemoryBookmarkStorageAdapter();
    const state = createBookmarkState({
      remote,
      storage,
      lifecycle: createMemoryBookmarkLifecycleAdapter(),
    });
    await state.initialize({ folderId });
    storage.writeSnapshot = () => Promise.reject(new Error('IndexedDB failed'));

    const result = await state.executeCommand({
      type: 'editFolder',
      operationId: 'a0000000-0000-4000-8000-000000000008',
      folderId,
      folderVersion: 1,
      name: 'Saved remotely',
    });

    expect(result?.status).toBe('acknowledged');
    expect(state.getState()).toMatchObject({
      snapshotRevision: 2,
      selectedFolder: { name: 'Saved remotely', version: 2 },
      writeStatus: 'failed',
      writeMessage: expect.stringContaining('was saved'),
    });
    state.dispose();
  });

  it('exposes a persisted unconfirmed operation after restart', async () => {
    const storage = createMemoryBookmarkStorageAdapter();
    const command = {
      type: 'editFolder' as const,
      operationId: 'a0000000-0000-4000-8000-000000000009',
      folderId,
      folderVersion: 1,
      name: 'Unconfirmed',
    };
    await storage.writeUnconfirmedOperation?.(command, '2026-08-18T20:00:00.000Z');
    const state = createBookmarkState({
      remote: createMemoryBookmarkRemoteAdapter(snapshot()),
      storage,
      lifecycle: createMemoryBookmarkLifecycleAdapter(),
    });

    await state.initialize({ folderId });

    expect(state.getState()).toMatchObject({
      writeStatus: 'unknown',
      unconfirmedOperations: [{ command }],
    });
    state.dispose();
  });

  it('clears an unconfirmed operation when its explicit retry settles as a conflict', async () => {
    const storage = createMemoryBookmarkStorageAdapter();
    const command = {
      type: 'editFolder' as const,
      operationId: 'a0000000-0000-4000-8000-000000000010',
      folderId,
      folderVersion: 1,
      name: 'Unconfirmed',
    };
    await storage.writeUnconfirmedOperation?.(command, '2026-08-18T20:00:00.000Z');
    const remote = createMemoryBookmarkRemoteAdapter(snapshot());
    remote.executeCommand = () =>
      Promise.resolve({
        status: 'conflict',
        operationId: command.operationId,
        code: 'stale_entity',
        revision: 1,
        folders: [snapshot().folders[1]!],
        bookmarks: [],
        tags: [],
        sequences: [],
      });
    const state = createBookmarkState({
      remote,
      storage,
      lifecycle: createMemoryBookmarkLifecycleAdapter(),
    });
    await state.initialize({ folderId });

    await state.retryUnconfirmed(command.operationId);

    expect(state.getState()).toMatchObject({
      writeStatus: 'conflict',
      unconfirmedOperations: [],
    });
    expect(await storage.readUnconfirmedOperations?.()).toEqual([]);
    state.dispose();
  });
});
