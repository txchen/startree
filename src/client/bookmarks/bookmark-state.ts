import type { Bookmark, BookmarkFolder, BookmarkSnapshot } from '../../shared/bookmarks/contracts';
import { SYSTEM_ROOT_FOLDER_ID } from '../../shared/bookmarks/contracts';

export type BookmarkNavigation = {
  selectedFolderId: string;
  expandedFolderIds: string[];
};

export type BookmarkRemoteAdapter = {
  readSnapshot(revision: number | null): Promise<BookmarkSnapshot | null>;
};

export type BookmarkStorageAdapter = {
  readSnapshot(): Promise<BookmarkSnapshot | null>;
  writeSnapshot(snapshot: BookmarkSnapshot): Promise<void>;
  readNavigation(): Promise<BookmarkNavigation | null>;
  writeNavigation(navigation: BookmarkNavigation): Promise<void>;
};

export type BookmarkStateView = Readonly<{
  status: 'loading' | 'ready' | 'not-found' | 'error';
  snapshotRevision: number | null;
  selectedFolder: BookmarkFolder | null;
  folders: readonly BookmarkFolder[];
  breadcrumbs: readonly BookmarkFolder[];
  directFolders: readonly BookmarkFolder[];
  directBookmarks: readonly Bookmark[];
  tagsByBookmark: Readonly<Record<string, readonly string[]>>;
  expandedFolderIds: readonly string[];
  notice: string | null;
}>;

export type BookmarkState = {
  getState(): BookmarkStateView;
  subscribe(listener: (state: BookmarkStateView) => void): () => void;
  initialize(options?: { folderId?: string }): Promise<void>;
  refresh(): Promise<void>;
  selectFolder(folderId: string): Promise<boolean>;
  toggleFolderExpanded(folderId: string): Promise<void>;
};

type MutableState = {
  status: BookmarkStateView['status'];
  snapshot: BookmarkSnapshot | null;
  selectedFolderId: string;
  expandedFolderIds: string[];
  notice: string | null;
};

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
    tagsByBookmark,
    expandedFolderIds: state.expandedFolderIds,
    notice: state.notice,
  };
};

export const createBookmarkState = (adapters: {
  remote: BookmarkRemoteAdapter;
  storage: BookmarkStorageAdapter;
}): BookmarkState => {
  const state: MutableState = {
    status: 'loading',
    snapshot: null,
    selectedFolderId: SYSTEM_ROOT_FOLDER_ID,
    expandedFolderIds: [],
    notice: null,
  };
  const listeners = new Set<(state: BookmarkStateView) => void>();
  let routeFolderId: string | undefined;

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

  const promote = async (snapshot: BookmarkSnapshot, fromRefresh: boolean) => {
    const selectedWasAvailable =
      state.snapshot?.folders.some((folder) => folder.id === state.selectedFolderId) ?? false;
    state.snapshot = snapshot;
    await adapters.storage.writeSnapshot(snapshot);
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
    try {
      const replacement = await adapters.remote.readSnapshot(state.snapshot?.revision ?? null);
      if (replacement) await promote(replacement, true);
      if (state.snapshot && state.status === 'loading') state.status = 'ready';
      emit();
    } catch {
      if (!state.snapshot) state.status = 'error';
      emit();
    }
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
      const [storedSnapshot, navigation] = await Promise.all([
        adapters.storage.readSnapshot(),
        adapters.storage.readNavigation(),
      ]);
      state.snapshot = storedSnapshot;
      state.expandedFolderIds = navigation?.expandedFolderIds ?? [];
      const preferredFolderId =
        routeFolderId ?? navigation?.selectedFolderId ?? SYSTEM_ROOT_FOLDER_ID;
      if (storedSnapshot) {
        settleSelection(preferredFolderId, routeFolderId !== undefined);
        emit();
      }

      try {
        const replacement = await adapters.remote.readSnapshot(storedSnapshot?.revision ?? null);
        if (replacement) await promote(replacement, false);
        if (state.snapshot) settleSelection(preferredFolderId, routeFolderId !== undefined);
        else state.status = 'error';
        if (state.status === 'ready') await writeNavigation();
        emit();
      } catch {
        if (!state.snapshot) state.status = 'error';
        emit();
      }
    },
    refresh,
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
  };
};
