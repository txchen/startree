import type {
  Bookmark,
  BookmarkCommand,
  BookmarkCommandResult,
  BookmarkFolder,
  BookmarkSequence,
  BookmarkSnapshot,
} from '../../shared/bookmarks/contracts';
import {
  bookmarkTitleFor,
  normalizeBookmarkTags,
  SYSTEM_ROOT_FOLDER_ID,
  visitBookmarkCommand,
} from '../../shared/bookmarks/contracts';
import type { BookmarkSearchAdapter, BookmarkSearchResult } from './bookmark-search';

export type BookmarkNavigation = {
  selectedFolderId: string;
  expandedFolderIds: string[];
};

export type BookmarkRemoteAdapter = {
  readSnapshot(revision: number | null, signal?: AbortSignal): Promise<BookmarkSnapshot | null>;
  executeCommand?(command: BookmarkCommand, signal?: AbortSignal): Promise<BookmarkCommandResult>;
};

export type UnconfirmedBookmarkOperation = {
  command: BookmarkCommand;
  recordedAt: string;
};

export type StoredBookmarkSnapshot =
  | { status: 'empty' }
  | { status: 'compatible'; snapshot: BookmarkSnapshot; synchronizedAt: string | null }
  | { status: 'incompatible'; wireFormatVersion: number | null };

export type BookmarkStorageAdapter = {
  readSnapshot(): Promise<StoredBookmarkSnapshot>;
  writeSnapshot(snapshot: BookmarkSnapshot, metadata: { synchronizedAt: string }): Promise<void>;
  readNavigation(): Promise<BookmarkNavigation | null>;
  writeNavigation(navigation: BookmarkNavigation): Promise<void>;
  clear(): Promise<void>;
  readUnconfirmedOperations?(): Promise<UnconfirmedBookmarkOperation[]>;
  writeUnconfirmedOperation?(command: BookmarkCommand, recordedAt: string): Promise<void>;
  removeUnconfirmedOperation?(operationId: string): Promise<void>;
};

export type BookmarkLifecycleAdapter = {
  now(): number;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, delay: number): unknown;
  clearInterval(handle: unknown): void;
  isOnline(): boolean;
  isVisible(): boolean;
  subscribe(event: 'online' | 'offline' | 'visibilitychange', listener: () => void): () => void;
};

export type BookmarkStateView = Readonly<{
  status: 'loading' | 'ready' | 'not-found' | 'error';
  snapshotRevision: number | null;
  selectedFolder: BookmarkFolder | null;
  folders: readonly BookmarkFolder[];
  breadcrumbs: readonly BookmarkFolder[];
  directFolders: readonly BookmarkFolder[];
  directBookmarks: readonly Bookmark[];
  sequences: readonly BookmarkSequence[];
  tagsByBookmark: Readonly<Record<string, readonly string[]>>;
  expandedFolderIds: readonly string[];
  notice: string | null;
  syncStatus: 'idle' | 'syncing' | 'slow' | 'failed' | 'offline';
  lastSuccessfulSyncAt: string | null;
  retainedSnapshotCompatibility: 'none' | 'compatible' | 'incompatible';
  coldLoadProgressVisible: boolean;
  searchQuery: string;
  searchResults: readonly BookmarkSearchResult[];
  writeStatus: 'idle' | 'pending' | 'failed' | 'conflict' | 'unknown';
  writeMessage: string | null;
  unconfirmedOperations: readonly UnconfirmedBookmarkOperation[];
}>;

export type BookmarkState = {
  getState(): BookmarkStateView;
  subscribe(listener: (state: BookmarkStateView) => void): () => void;
  initialize(options?: { folderId?: string }): Promise<void>;
  refresh(): Promise<void>;
  refreshAfterMutation(): Promise<void>;
  search(query: string): Promise<void>;
  selectFolder(folderId: string): Promise<boolean>;
  toggleFolderExpanded(folderId: string): Promise<void>;
  executeCommand(command: BookmarkCommand): Promise<BookmarkCommandResult | null>;
  retryUnconfirmed(operationId: string): Promise<BookmarkCommandResult | null>;
  dispose(): void;
};

type MutableState = {
  status: BookmarkStateView['status'];
  snapshot: BookmarkSnapshot | null;
  selectedFolderId: string;
  expandedFolderIds: string[];
  notice: string | null;
  syncStatus: BookmarkStateView['syncStatus'];
  lastSuccessfulSyncAt: string | null;
  retainedSnapshotCompatibility: BookmarkStateView['retainedSnapshotCompatibility'];
  searchQuery: string;
  searchResults: BookmarkSearchResult[];
  writeStatus: BookmarkStateView['writeStatus'];
  writeMessage: string | null;
  unconfirmedOperations: UnconfirmedBookmarkOperation[];
};

const createDefaultLifecycleAdapter = (): BookmarkLifecycleAdapter => ({
  now: () => Date.now(),
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, delay) => globalThis.setInterval(callback, delay),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  isVisible: () =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  subscribe(event, listener) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
    const target = event === 'visibilitychange' ? document : window;
    target.addEventListener(event, listener);
    return () => target.removeEventListener(event, listener);
  },
});

const byRank = <Item extends { id: string; rank: string }>(left: Item, right: Item): number =>
  left.rank.localeCompare(right.rank) || left.id.localeCompare(right.id);

const rootDisplayFolder = (folder: BookmarkFolder): BookmarkFolder => ({
  ...folder,
  name: 'Bookmarks',
});

const viewFor = (state: MutableState): BookmarkStateView => {
  const folders = state.snapshot?.folders ?? [];
  const selectedFolder = folders.find((folder) => folder.id === state.selectedFolderId) ?? null;
  const breadcrumbs: BookmarkFolder[] = [];
  let cursor = selectedFolder;
  while (cursor) {
    breadcrumbs.unshift(cursor.parentId === null ? rootDisplayFolder(cursor) : cursor);
    const parentId: string | null = cursor.parentId;
    cursor = parentId ? (folders.find((folder) => folder.id === parentId) ?? null) : null;
  }

  const tagsByBookmark: Record<string, string[]> = {};
  for (const tag of state.snapshot?.tags ?? []) {
    (tagsByBookmark[tag.bookmarkId] ??= []).push(tag.value);
  }

  return {
    status: state.status,
    snapshotRevision: state.snapshot?.revision ?? null,
    selectedFolder,
    folders,
    breadcrumbs,
    directFolders: selectedFolder
      ? folders.filter((folder) => folder.parentId === selectedFolder.id).sort(byRank)
      : [],
    directBookmarks: selectedFolder
      ? (state.snapshot?.bookmarks ?? [])
          .filter((bookmark) => bookmark.folderId === selectedFolder.id)
          .sort(byRank)
      : [],
    sequences: state.snapshot?.sequences ?? [],
    tagsByBookmark,
    expandedFolderIds: state.expandedFolderIds,
    notice: state.notice,
    syncStatus: state.syncStatus,
    lastSuccessfulSyncAt: state.lastSuccessfulSyncAt,
    retainedSnapshotCompatibility: state.retainedSnapshotCompatibility,
    coldLoadProgressVisible:
      state.status === 'loading' && !state.snapshot && state.syncStatus === 'syncing',
    searchQuery: state.searchQuery,
    searchResults: state.searchResults,
    writeStatus: state.writeStatus,
    writeMessage: state.writeMessage,
    unconfirmedOperations: state.unconfirmedOperations,
  };
};

export const createBookmarkState = (adapters: {
  remote: BookmarkRemoteAdapter;
  storage: BookmarkStorageAdapter;
  lifecycle?: BookmarkLifecycleAdapter;
  search?: BookmarkSearchAdapter;
}): BookmarkState => {
  const lifecycle = adapters.lifecycle ?? createDefaultLifecycleAdapter();
  const state: MutableState = {
    status: 'loading',
    snapshot: null,
    selectedFolderId: SYSTEM_ROOT_FOLDER_ID,
    expandedFolderIds: [],
    notice: null,
    syncStatus: 'idle',
    lastSuccessfulSyncAt: null,
    retainedSnapshotCompatibility: 'none',
    searchQuery: '',
    searchResults: [],
    writeStatus: 'idle',
    writeMessage: null,
    unconfirmedOperations: [],
  };
  const listeners = new Set<(state: BookmarkStateView) => void>();
  let routeFolderId: string | undefined;
  let refreshPromise: Promise<void> | null = null;
  let refreshStartedAt = Number.NEGATIVE_INFINITY;
  let intervalHandle: unknown;
  const lifecycleUnsubscribers: Array<() => void> = [];
  let searchRequest = 0;
  let writeBusy = false;
  let writeQueue: Promise<unknown> = Promise.resolve();

  const emit = () => {
    const view = viewFor(state);
    for (const listener of listeners) listener(view);
  };

  const writeNavigation = () =>
    adapters.storage.writeNavigation({
      selectedFolderId: state.selectedFolderId,
      expandedFolderIds: [...state.expandedFolderIds],
    });

  const settleSelection = (preferredFolderId: string, explicit: boolean) => {
    const exists =
      state.snapshot?.folders.some((folder) => folder.id === preferredFolderId) ?? false;
    if (exists) {
      state.selectedFolderId = preferredFolderId;
      state.status = 'ready';
      return;
    }
    if (explicit) {
      state.selectedFolderId = preferredFolderId;
      state.status = 'not-found';
      return;
    }
    state.selectedFolderId = SYSTEM_ROOT_FOLDER_ID;
    state.status = 'ready';
    state.notice = 'The remembered Folder is no longer available. Showing Bookmarks instead.';
  };

  const promote = async (
    snapshot: BookmarkSnapshot,
    fromRefresh: boolean,
    synchronizedAt: string,
  ) => {
    const selectedWasAvailable =
      state.snapshot?.folders.some((folder) => folder.id === state.selectedFolderId) ?? false;
    await adapters.storage.writeSnapshot(snapshot, { synchronizedAt });
    state.snapshot = snapshot;
    state.lastSuccessfulSyncAt = synchronizedAt;
    state.retainedSnapshotCompatibility = 'compatible';
    if (adapters.search) {
      await adapters.search.replace(snapshot);
      if (state.searchQuery) {
        state.searchResults = [...(await adapters.search.search(state.searchQuery))];
      }
    }
    if (
      fromRefresh &&
      selectedWasAvailable &&
      !snapshot.folders.some((folder) => folder.id === state.selectedFolderId)
    ) {
      state.selectedFolderId = SYSTEM_ROOT_FOLDER_ID;
      state.status = 'ready';
      state.notice = 'The selected Folder is no longer available. Showing Bookmarks instead.';
      await writeNavigation();
    }
  };

  const refresh = async () => {
    if (refreshPromise) {
      const activeRefresh = refreshPromise;
      const retryAfterward = state.syncStatus === 'slow' || state.syncStatus === 'failed';
      await activeRefresh;
      if (retryAfterward) await refresh();
      return;
    }
    if (!lifecycle.isOnline()) {
      state.syncStatus = 'offline';
      if (!state.snapshot) state.status = 'error';
      emit();
      return;
    }

    refreshPromise = (async () => {
      refreshStartedAt = lifecycle.now();
      const progressDelay = state.snapshot ? 2_000 : 2_500;
      const controller = new AbortController();
      const progressTimer = lifecycle.setTimeout(() => {
        state.syncStatus = 'syncing';
        emit();
      }, progressDelay);
      const slowTimer = lifecycle.setTimeout(() => {
        state.syncStatus = 'slow';
        controller.abort();
        emit();
      }, 5_000);

      try {
        const replacement = await adapters.remote.readSnapshot(
          state.snapshot?.revision ?? null,
          controller.signal,
        );
        const synchronizedAt = new Date(lifecycle.now()).toISOString();
        if (replacement) await promote(replacement, true, synchronizedAt);
        else if (state.snapshot) {
          await adapters.storage.writeSnapshot(state.snapshot, { synchronizedAt });
          state.lastSuccessfulSyncAt = synchronizedAt;
        }
        state.syncStatus = 'idle';
      } catch {
        state.syncStatus = controller.signal.aborted
          ? 'slow'
          : lifecycle.isOnline()
            ? 'failed'
            : 'offline';
        if (!state.snapshot) state.status = 'error';
      } finally {
        lifecycle.clearTimeout(progressTimer);
        lifecycle.clearTimeout(slowTimer);
        refreshPromise = null;
        emit();
      }
    })();
    return refreshPromise;
  };

  const applyOptimisticCommand = (command: BookmarkCommand) => {
    if (!state.snapshot) return;
    const timestamp = new Date(lifecycle.now()).toISOString();
    visitBookmarkCommand(command, {
      createFolder(createCommand) {
        state.snapshot?.folders.push({
          id: createCommand.operationId,
          name: createCommand.name,
          parentId: createCommand.parentId,
          rank: 'zzzz',
          createdAt: timestamp,
          modifiedAt: timestamp,
          version: 1,
        });
      },
      editFolder(editCommand) {
        if (!state.snapshot) return;
        state.snapshot.folders = state.snapshot.folders.map((folder) =>
          folder.id === editCommand.folderId
            ? { ...folder, name: editCommand.name, modifiedAt: timestamp }
            : folder,
        );
      },
      createBookmark(createCommand) {
        if (!state.snapshot) return;
        state.snapshot.bookmarks.push({
          id: createCommand.operationId,
          folderId: createCommand.folderId,
          url: createCommand.url,
          title: bookmarkTitleFor(createCommand.url, createCommand.title),
          note: createCommand.note,
          rank: 'zzzz',
          createdAt: timestamp,
          modifiedAt: timestamp,
          version: 1,
        });
        state.snapshot.tags.push(
          ...normalizeBookmarkTags(createCommand.tags).map((value) => ({
            bookmarkId: createCommand.operationId,
            value,
          })),
        );
      },
      editBookmark(editCommand) {
        if (!state.snapshot) return;
        state.snapshot.bookmarks = state.snapshot.bookmarks.map((bookmark) =>
          bookmark.id === editCommand.bookmarkId
            ? {
                ...bookmark,
                url: editCommand.url,
                title: editCommand.title,
                note: editCommand.note,
                modifiedAt: timestamp,
              }
            : bookmark,
        );
        state.snapshot.tags = [
          ...state.snapshot.tags.filter((tag) => tag.bookmarkId !== editCommand.bookmarkId),
          ...normalizeBookmarkTags(editCommand.tags).map((value) => ({
            bookmarkId: editCommand.bookmarkId,
            value,
          })),
        ];
      },
    });
  };

  const mergeCommandResult = (
    snapshot: BookmarkSnapshot,
    result: BookmarkCommandResult,
  ): BookmarkSnapshot => {
    const folderIds = new Set(result.folders.map((folder) => folder.id));
    const bookmarkIds = new Set(result.bookmarks.map((bookmark) => bookmark.id));
    const sequenceFolderIds = new Set(result.sequences.map((sequence) => sequence.folderId));
    return {
      ...snapshot,
      revision: result.revision,
      folders: [
        ...snapshot.folders.filter((folder) => !folderIds.has(folder.id)),
        ...result.folders,
      ],
      bookmarks: [
        ...snapshot.bookmarks.filter((bookmark) => !bookmarkIds.has(bookmark.id)),
        ...result.bookmarks,
      ],
      tags: [...snapshot.tags.filter((tag) => !bookmarkIds.has(tag.bookmarkId)), ...result.tags],
      sequences: [
        ...snapshot.sequences.filter((sequence) => !sequenceFolderIds.has(sequence.folderId)),
        ...result.sequences,
      ],
    };
  };

  const performCommand = async (
    command: BookmarkCommand,
  ): Promise<BookmarkCommandResult | null> => {
    if (!lifecycle.isOnline()) {
      state.writeStatus = 'failed';
      state.writeMessage = 'Editing requires an online connection.';
      emit();
      return null;
    }
    if (!state.snapshot || !adapters.remote.executeCommand) {
      state.writeStatus = 'failed';
      state.writeMessage = 'Editing is not available.';
      emit();
      return null;
    }
    const priorSnapshot = structuredClone(state.snapshot);
    state.snapshot = structuredClone(state.snapshot);
    applyOptimisticCommand(command);
    state.writeStatus = 'pending';
    state.writeMessage = 'Saving changes…';
    emit();
    const pendingTimer = lifecycle.setTimeout(() => {
      state.writeStatus = 'pending';
      state.writeMessage = 'Still saving changes…';
      emit();
    }, 1_000);
    let settledResult: BookmarkCommandResult | undefined;

    try {
      const result = await adapters.remote.executeCommand(command);
      settledResult = result;
      lifecycle.clearTimeout(pendingTimer);
      state.snapshot = priorSnapshot;
      if (result.status === 'conflict') {
        if (result.revision === priorSnapshot.revision) {
          state.snapshot = mergeCommandResult(state.snapshot, result);
        } else {
          await refresh();
        }
        await adapters.storage.removeUnconfirmedOperation?.(command.operationId);
        state.unconfirmedOperations = state.unconfirmedOperations.filter(
          (item) => item.command.operationId !== command.operationId,
        );
        state.writeStatus = 'conflict';
        state.writeMessage = 'The item changed elsewhere. Review the current authoritative data.';
        emit();
        return result;
      }
      if (result.revision !== priorSnapshot.revision + 1) {
        state.writeStatus = 'pending';
        state.writeMessage = 'Refreshing authoritative Bookmarks…';
        emit();
        await refresh();
      } else {
        state.snapshot = mergeCommandResult(priorSnapshot, result);
        const synchronizedAt = new Date(lifecycle.now()).toISOString();
        await adapters.storage.writeSnapshot(state.snapshot, { synchronizedAt });
        state.lastSuccessfulSyncAt = synchronizedAt;
      }
      state.unconfirmedOperations = state.unconfirmedOperations.filter(
        (item) => item.command.operationId !== command.operationId,
      );
      await adapters.storage.removeUnconfirmedOperation?.(command.operationId);
      state.writeStatus = 'idle';
      state.writeMessage = null;
      emit();
      return result;
    } catch (error) {
      lifecycle.clearTimeout(pendingTimer);
      if (settledResult?.status === 'acknowledged') {
        state.writeStatus = 'failed';
        state.writeMessage = 'The change was saved, but local retention failed.';
        emit();
        return settledResult;
      }
      if (settledResult?.status === 'conflict') {
        state.writeStatus = 'conflict';
        state.writeMessage =
          'The item changed elsewhere, but the settled result could not be retained locally.';
        emit();
        return settledResult;
      }
      state.snapshot = priorSnapshot;
      if (error instanceof Error && error.name === 'UnknownBookmarkCommandError') {
        const recordedAt = new Date(lifecycle.now()).toISOString();
        const unconfirmed = { command, recordedAt };
        await adapters.storage.writeUnconfirmedOperation?.(command, recordedAt);
        state.unconfirmedOperations = [
          ...state.unconfirmedOperations.filter(
            (item) => item.command.operationId !== command.operationId,
          ),
          unconfirmed,
        ];
        state.writeStatus = 'unknown';
        state.writeMessage = 'The save result is unknown. Authoritative Bookmarks were refreshed.';
        emit();
        await refresh();
      } else {
        state.writeStatus = 'failed';
        state.writeMessage = 'The change was not saved.';
        emit();
      }
      return null;
    }
  };

  const enqueueCommand = (command: BookmarkCommand): Promise<BookmarkCommandResult | null> => {
    if (!writeBusy) {
      writeBusy = true;
      const immediate = performCommand(command);
      writeQueue = immediate.finally(() => {
        writeBusy = false;
      });
      return immediate;
    }
    const queued = writeQueue.then(() => {
      writeBusy = true;
      return performCommand(command);
    });
    writeQueue = queued.finally(() => {
      writeBusy = false;
    });
    return queued;
  };

  const bindLifecycle = () => {
    if (intervalHandle !== undefined) return;
    lifecycleUnsubscribers.push(
      lifecycle.subscribe('online', () => void refresh()),
      lifecycle.subscribe('offline', () => {
        state.syncStatus = 'offline';
        emit();
      }),
      lifecycle.subscribe('visibilitychange', () => {
        if (
          lifecycle.isVisible() &&
          lifecycle.isOnline() &&
          lifecycle.now() - refreshStartedAt >= 60_000
        ) {
          void refresh();
        }
      }),
    );
    intervalHandle = lifecycle.setInterval(() => {
      if (lifecycle.isVisible() && lifecycle.isOnline()) void refresh();
    }, 60_000);
  };

  return {
    getState: () => viewFor(state),
    subscribe(listener) {
      listeners.add(listener);
      listener(viewFor(state));
      return () => listeners.delete(listener);
    },
    async initialize(options) {
      routeFolderId = options?.folderId;
      const [storedSnapshot, navigation, unconfirmedOperations] = await Promise.all([
        adapters.storage.readSnapshot(),
        adapters.storage.readNavigation(),
        adapters.storage.readUnconfirmedOperations?.() ?? Promise.resolve([]),
      ]);
      state.snapshot = storedSnapshot.status === 'compatible' ? storedSnapshot.snapshot : null;
      state.lastSuccessfulSyncAt =
        storedSnapshot.status === 'compatible' ? storedSnapshot.synchronizedAt : null;
      state.retainedSnapshotCompatibility =
        storedSnapshot.status === 'empty' ? 'none' : storedSnapshot.status;
      state.expandedFolderIds = navigation?.expandedFolderIds ?? [];
      state.unconfirmedOperations = unconfirmedOperations;
      const preferredFolderId =
        routeFolderId ?? navigation?.selectedFolderId ?? SYSTEM_ROOT_FOLDER_ID;
      if (state.snapshot) {
        settleSelection(preferredFolderId, routeFolderId !== undefined);
        emit();
        await adapters.search?.replace(state.snapshot);
      }
      bindLifecycle();
      await refresh();
      if (state.snapshot) settleSelection(preferredFolderId, routeFolderId !== undefined);
      else state.status = 'error';
      if (state.status === 'ready') await writeNavigation();
      if (state.unconfirmedOperations.length) {
        state.writeStatus = 'unknown';
        state.writeMessage = 'A previous save result is unknown. Review and retry explicitly.';
      }
      emit();
    },
    refresh,
    refreshAfterMutation: refresh,
    async search(query) {
      const currentRequest = ++searchRequest;
      state.searchQuery = query;
      if (!query.trim() || !adapters.search) {
        state.searchResults = [];
        emit();
        return;
      }
      const results = await adapters.search.search(query);
      if (currentRequest !== searchRequest) return;
      state.searchResults = [...results];
      emit();
    },
    async selectFolder(folderId) {
      if (!state.snapshot?.folders.some((folder) => folder.id === folderId)) {
        state.selectedFolderId = folderId;
        state.status = 'not-found';
        state.notice = null;
        emit();
        return false;
      }
      state.selectedFolderId = folderId;
      state.status = 'ready';
      state.notice = null;
      await writeNavigation();
      emit();
      return true;
    },
    async toggleFolderExpanded(folderId) {
      state.expandedFolderIds = state.expandedFolderIds.includes(folderId)
        ? state.expandedFolderIds.filter((id) => id !== folderId)
        : [...state.expandedFolderIds, folderId];
      await writeNavigation();
      emit();
    },
    executeCommand: enqueueCommand,
    async retryUnconfirmed(operationId) {
      const operation = state.unconfirmedOperations.find(
        (item) => item.command.operationId === operationId,
      );
      if (!operation) return null;
      return enqueueCommand(operation.command);
    },
    dispose() {
      if (intervalHandle !== undefined) lifecycle.clearInterval(intervalHandle);
      intervalHandle = undefined;
      for (const unsubscribe of lifecycleUnsubscribers.splice(0)) unsubscribe();
      adapters.search?.dispose();
    },
  };
};
