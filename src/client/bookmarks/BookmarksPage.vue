<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from 'vue';

import { SYSTEM_ROOT_FOLDER_ID } from '../../shared/bookmarks/contracts';
import type {
  Bookmark,
  BookmarkCommand,
  BookmarkFolder,
  BookmarkTrashRoot,
} from '../../shared/bookmarks/contracts';
import BookmarkCard from './BookmarkCard.vue';
import PinnedBookmarks from './PinnedBookmarks.vue';
import RecentBookmarks from './RecentBookmarks.vue';
import { createRecentBookmarks } from './recent-bookmarks';
import type { BookmarkEditorValue } from './bookmark-editor';
import {
  createBroadcastBookmarkRevisionChannel,
  createFetchBookmarkAdapter,
  createIndexedDbBookmarkAdapter,
} from './bookmark-adapters';
import {
  BOOKMARK_SEARCH_RESULT_LIMIT,
  bookmarkSearchFiltersActive,
  createWorkerBookmarkSearchAdapter,
  EMPTY_BOOKMARK_SEARCH_FILTERS,
  type BookmarkSearchFilters,
  type BookmarkSearchScope,
} from './bookmark-search';
import {
  bookmarkFolderPaths,
  bookmarkFacetsFor,
  bookmarksMatchingUrl,
  duplicateBookmarkGroups,
  recursiveBookmarkCountsByFolder,
} from './bookmark-library';
import { createBookmarkState, type BookmarkStateView } from './bookmark-state';
import { trapDialogFocus } from './dialog-focus';
import FolderNavigation from './FolderNavigation.vue';

const BookmarkEditorModal = defineAsyncComponent(() => import('./BookmarkEditorModal.vue'));
const BookmarkMoveModal = defineAsyncComponent(() => import('./BookmarkMoveModal.vue'));
const BookmarksDuplicatesView = defineAsyncComponent(() => import('./BookmarksDuplicatesView.vue'));
const BookmarksTrashView = defineAsyncComponent(() => import('./BookmarksTrashView.vue'));

const props = defineProps<{ legacyFolderId?: string }>();
const emit = defineEmits<{ canonicalize: [] }>();
const SIDEBAR_WIDTH_STORAGE_KEY = 'startree-folder-sidebar-width';
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 220;
const SIDEBAR_KEYBOARD_STEP = 16;
const drawerOpen = ref(false);
const mobileFolderButton = ref<HTMLButtonElement>();
const drawerCloseButton = ref<HTMLButtonElement>();
const initialized = ref(false);
const searchInput = ref<HTMLInputElement>();
const selectedSearchResult = ref(0);
const searchFiltersOpen = ref(false);
const selectedTagFacet = ref('');
const selectedDomainFacet = ref('');
const editor = ref<{
  kind: 'folder' | 'bookmark';
  folder?: BookmarkFolder;
  bookmark?: Bookmark;
} | null>(null);
const editorDraft = ref<BookmarkEditorValue>({});
const editorInitialValue = ref<BookmarkEditorValue>({});
const desktopEditingAvailable = ref(false);
const sidebarWidth = ref(SIDEBAR_DEFAULT_WIDTH);
const resizingSidebar = ref(false);
let resizePointerId: number | null = null;
let resizeStartX = 0;
let resizeStartWidth = SIDEBAR_DEFAULT_WIDTH;
const editMode = ref(false);
const dragged = ref<{ kind: 'folder' | 'bookmark'; id: string; index: number } | null>(null);
const moveEditor = ref<{ kind: 'folder' | 'bookmark'; id: string } | null>(null);
const moveDestinationId = ref(SYSTEM_ROOT_FOLDER_ID);
const moveBeforeId = ref('');
let moveReturnFocus: HTMLElement | null = null;
const trashOpen = ref(false);
const duplicatesOpen = ref(false);
const undoableTrash = ref<{ root: BookmarkTrashRoot; version: number } | null>(null);
const bookmarkStorage = createIndexedDbBookmarkAdapter();
const stateModule = createBookmarkState({
  remote: createFetchBookmarkAdapter(),
  storage: bookmarkStorage,
  search: createWorkerBookmarkSearchAdapter(),
  revisionChannel: createBroadcastBookmarkRevisionChannel(),
});
const state = shallowRef<BookmarkStateView>(stateModule.getState());
const library = shallowRef(state.value);
let unsubscribe: (() => void) | undefined;
let desktopMedia: MediaQueryList | undefined;
const updateDesktopEditing = () => {
  desktopEditingAvailable.value = desktopMedia?.matches ?? false;
};

const clampSidebarWidth = (value: number) =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));

const persistSidebarWidth = () => {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth.value));
  } catch {
    // Resizing still works when browser storage is unavailable.
  }
};

const startSidebarResize = (event: PointerEvent) => {
  if (event.button !== 0) return;
  resizePointerId = event.pointerId;
  resizeStartX = event.clientX;
  resizeStartWidth = sidebarWidth.value;
  resizingSidebar.value = true;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
};

const resizeSidebar = (event: PointerEvent) => {
  if (event.pointerId !== resizePointerId) return;
  sidebarWidth.value = clampSidebarWidth(resizeStartWidth + event.clientX - resizeStartX);
};

const finishSidebarResize = (event: PointerEvent) => {
  if (event.pointerId !== resizePointerId) return;
  resizePointerId = null;
  resizingSidebar.value = false;
  persistSidebarWidth();
};

const resizeSidebarWithKeyboard = (event: KeyboardEvent) => {
  let width: number | undefined;
  if (event.key === 'ArrowLeft') width = sidebarWidth.value - SIDEBAR_KEYBOARD_STEP;
  if (event.key === 'ArrowRight') width = sidebarWidth.value + SIDEBAR_KEYBOARD_STEP;
  if (event.key === 'Home') width = SIDEBAR_MIN_WIDTH;
  if (event.key === 'End') width = SIDEBAR_MAX_WIDTH;
  if (width === undefined) return;
  event.preventDefault();
  sidebarWidth.value = clampSidebarWidth(width);
  persistSidebarWidth();
};

const searchOpen = computed(
  () =>
    state.value.searchQuery.trim().length > 0 ||
    bookmarkSearchFiltersActive(state.value.searchFilters),
);
const editingAvailable = computed(
  () => desktopEditingAvailable.value && state.value.syncStatus !== 'offline',
);
const mutationPending = computed(() => state.value.writeStatus === 'pending');
const pinWritable = computed(() => state.value.syncStatus !== 'offline' && !mutationPending.value);
const pinnedBookmarks = computed(() =>
  library.value.bookmarks
    .filter((bookmark) => bookmark.pinRank)
    .sort((left, right) =>
      left.pinRank! < right.pinRank!
        ? -1
        : left.pinRank! > right.pinRank!
          ? 1
          : left.id.localeCompare(right.id),
    ),
);
const recentHistory = createRecentBookmarks(bookmarkStorage);
const recentIds = shallowRef<string[]>([]);
const recentChannel = new BroadcastChannel('startree-recent-bookmarks');
let recentDisposed = false;
const recentBookmarks = computed(() => {
  return recentIds.value.flatMap((id) => {
    const bookmark = library.value.bookmarksById.get(id);
    return bookmark ? [bookmark] : [];
  });
});
const recordOpening = async (id: string) => {
  recentIds.value = await recentHistory.record(id);
  if (!recentDisposed) recentChannel.postMessage('changed');
};
const recordLinkOpening = (event: MouseEvent) => {
  if (event.defaultPrevented || (event.type === 'click' ? event.button !== 0 : event.button !== 1))
    return;
  const anchor =
    event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>('a[data-open-bookmark-id]')
      : null;
  if (anchor?.dataset.openBookmarkId) void recordOpening(anchor.dataset.openBookmarkId);
};
const clearRecent = async () => {
  recentIds.value = await recentHistory.clear();
  if (!recentDisposed) recentChannel.postMessage('changed');
};
const syncRecentHistory = async () => {
  recentIds.value = await recentHistory.read();
};

const setBookmarkPin = async (bookmarkId: string, pinned: boolean, beforeBookmarkId?: string) => {
  if (!pinWritable.value || state.value.snapshotRevision === null) return;
  await stateModule.executeCommand({
    type: 'setBookmarkPin',
    operationId: crypto.randomUUID(),
    bookmarkId,
    pinned,
    expectedRevision: state.value.snapshotRevision,
    ...(beforeBookmarkId ? { beforeBookmarkId } : {}),
  });
};
const editorKey = computed(() => {
  const activeEditor = editor.value;
  if (!activeEditor) return 'closed';
  const entity = activeEditor.folder ?? activeEditor.bookmark;
  return `${activeEditor.kind}:${entity?.id ?? 'new'}:${entity?.version ?? 0}`;
});
const selectedResultId = computed(() =>
  state.value.searchResults[selectedSearchResult.value]
    ? `search-result-${selectedSearchResult.value}`
    : undefined,
);

const folderPaths = computed(() => bookmarkFolderPaths(library.value.folders));
const folderPathFor = (folderId: string): string => folderPaths.value[folderId] ?? 'Bookmarks';

const libraryFacets = computed(() =>
  bookmarkFacetsFor(library.value.bookmarks, library.value.tagsByBookmark),
);
const folderBookmarkCounts = computed(() =>
  recursiveBookmarkCountsByFolder(library.value.folders, library.value.bookmarks),
);
const duplicateGroups = computed(() => duplicateBookmarkGroups(library.value.bookmarks));
const editorDuplicateBookmarks = computed(() => {
  if (editor.value?.kind !== 'bookmark') return [];
  return bookmarksMatchingUrl(
    library.value.bookmarks,
    editorDraft.value.url ?? '',
    editor.value.bookmark?.id,
  );
});

const duplicateLocations = computed<Readonly<Record<string, string>>>(() =>
  Object.fromEntries(
    editorDuplicateBookmarks.value.map((bookmark) => [
      bookmark.id,
      folderPathFor(bookmark.folderId),
    ]),
  ),
);
const openDrawer = () => {
  drawerOpen.value = true;
  void nextTick(() => drawerCloseButton.value?.focus());
};

const closeDrawer = () => {
  drawerOpen.value = false;
  void nextTick(() => mobileFolderButton.value?.focus());
};

const navigateToFolder = async (folderId: string) => {
  drawerOpen.value = false;
  trashOpen.value = false;
  duplicatesOpen.value = false;
  await stateModule.selectFolder(folderId);
};

const toggleFolder = async (folderId: string) => {
  await stateModule.toggleFolderExpanded(folderId);
};

const updateSearch = async (event: Event) => {
  selectedSearchResult.value = 0;
  await stateModule.search((event.target as HTMLInputElement).value, state.value.searchFilters);
};

const closeSearch = async () => {
  searchFiltersOpen.value = false;
  selectedTagFacet.value = '';
  selectedDomainFacet.value = '';
  await stateModule.search('', EMPTY_BOOKMARK_SEARCH_FILTERS, 'global');
  selectedSearchResult.value = 0;
};

const updateSearchScope = async (event: Event) => {
  selectedSearchResult.value = 0;
  await stateModule.search(
    state.value.searchQuery,
    state.value.searchFilters,
    (event.target as HTMLSelectElement).value as BookmarkSearchScope,
  );
};

const updateSearchFilters = async (filters: BookmarkSearchFilters) => {
  selectedSearchResult.value = 0;
  await stateModule.search(state.value.searchQuery, filters);
};

const addSearchFilter = async (kind: 'tag' | 'domain', value: string) => {
  if (!value) return;
  const filters = state.value.searchFilters;
  await updateSearchFilters({
    tags: kind === 'tag' && !filters.tags.includes(value) ? [...filters.tags, value] : filters.tags,
    domains:
      kind === 'domain' && !filters.domains.includes(value)
        ? [...filters.domains, value]
        : filters.domains,
  });
  if (kind === 'tag') selectedTagFacet.value = '';
  else selectedDomainFacet.value = '';
};

const removeSearchFilter = async (kind: 'tag' | 'domain', value: string) => {
  const filters = state.value.searchFilters;
  await updateSearchFilters({
    tags: kind === 'tag' ? filters.tags.filter((tag) => tag !== value) : filters.tags,
    domains:
      kind === 'domain' ? filters.domains.filter((domain) => domain !== value) : filters.domains,
  });
};

const activateSearchResult = async (openInNewTab = false) => {
  const result = state.value.searchResults[selectedSearchResult.value];
  if (!result) return;
  if (result.kind === 'folder') {
    await closeSearch();
    await navigateToFolder(result.folderId);
    return;
  }
  if (openInNewTab) {
    void recordOpening(result.id);
    window.open(result.url, '_blank', 'noopener,noreferrer');
    return;
  }
  document
    .querySelector<HTMLAnchorElement>(`#search-result-${selectedSearchResult.value}`)
    ?.click();
};

const handleSearchKeydown = async (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    await closeSearch();
    return;
  }
  if (!state.value.searchResults.length) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    selectedSearchResult.value =
      (selectedSearchResult.value + 1) % state.value.searchResults.length;
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    selectedSearchResult.value =
      (selectedSearchResult.value - 1 + state.value.searchResults.length) %
      state.value.searchResults.length;
  } else if (event.key === 'Enter') {
    event.preventDefault();
    await activateSearchResult(event.metaKey || event.ctrlKey);
  }
};

const isFormControl = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

const handleGlobalKeydown = (event: KeyboardEvent) => {
  if (isFormControl(event.target)) return;
  const searchShortcut =
    event.key === '/' ||
    ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k');
  if (searchShortcut) {
    event.preventDefault();
    void nextTick(() => searchInput.value?.focus());
    return;
  }
  const addBookmarkShortcut =
    event.key.toLocaleLowerCase() === 'n' && !event.metaKey && !event.ctrlKey && !event.altKey;
  if (
    addBookmarkShortcut &&
    editingAvailable.value &&
    !mutationPending.value &&
    !editor.value &&
    !moveEditor.value &&
    !trashOpen.value &&
    !duplicatesOpen.value
  ) {
    event.preventDefault();
    openBookmarkEditor();
  }
};

const formatSyncTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : 'Never';

const selectedSequence = computed(() =>
  state.value.selectedFolder
    ? state.value.sequences.find((sequence) => sequence.folderId === state.value.selectedFolder?.id)
    : undefined,
);

const sequenceFor = (folderId: string) =>
  state.value.sequences.find((sequence) => sequence.folderId === folderId);

const reorderFolder = async (folderId: string, beforeFolderId?: string) => {
  if (mutationPending.value) return;
  const folder = library.value.foldersById.get(folderId);
  if (!folder?.parentId || folder.id === beforeFolderId) return null;
  const sequence = sequenceFor(folder.parentId);
  if (!sequence) return null;
  return stateModule.executeCommand({
    type: 'reorderFolder',
    operationId: crypto.randomUUID(),
    folderId: folder.id,
    folderVersion: folder.version,
    parentId: folder.parentId,
    expectedFolderSequenceVersion: sequence.folderVersion,
    ...(beforeFolderId ? { beforeFolderId } : {}),
  });
};

const reorderBookmark = async (bookmarkId: string, beforeBookmarkId?: string) => {
  if (mutationPending.value) return;
  const bookmark = library.value.bookmarksById.get(bookmarkId);
  if (!bookmark || bookmark.id === beforeBookmarkId) return null;
  const sequence = sequenceFor(bookmark.folderId);
  if (!sequence) return null;
  return stateModule.executeCommand({
    type: 'reorderBookmark',
    operationId: crypto.randomUUID(),
    bookmarkId: bookmark.id,
    bookmarkVersion: bookmark.version,
    folderId: bookmark.folderId,
    expectedBookmarkSequenceVersion: sequence.bookmarkVersion,
    ...(beforeBookmarkId ? { beforeBookmarkId } : {}),
  });
};

const beforeIdForDrop = (
  movingIndex: number,
  targetId?: string,
  targetIndex?: number,
  nextId?: string,
) => {
  if (!targetId) return undefined;
  if (targetIndex === undefined || movingIndex >= targetIndex) return targetId;
  return nextId;
};

const nextSiblingId = (event: DragEvent, attribute: string) => {
  const sibling = (event.currentTarget as HTMLElement | null)?.nextElementSibling;
  return sibling instanceof HTMLElement ? (sibling.dataset[attribute] ?? undefined) : undefined;
};

const dropFolder = async (beforeFolderId?: string, targetIndex?: number, nextFolderId?: string) => {
  const active = dragged.value;
  dragged.value = null;
  if (active?.kind === 'folder') {
    await reorderFolder(
      active.id,
      beforeIdForDrop(active.index, beforeFolderId, targetIndex, nextFolderId),
    );
  }
};

const dropBookmark = async (
  beforeBookmarkId?: string,
  targetIndex?: number,
  nextBookmarkId?: string,
) => {
  const active = dragged.value;
  dragged.value = null;
  if (active?.kind === 'bookmark') {
    await reorderBookmark(
      active.id,
      beforeIdForDrop(active.index, beforeBookmarkId, targetIndex, nextBookmarkId),
    );
  }
};

const openMoveEditor = (kind: 'folder' | 'bookmark', id: string) => {
  moveReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  moveEditor.value = { kind, id };
  moveDestinationId.value = state.value.selectedFolder?.id ?? SYSTEM_ROOT_FOLDER_ID;
  moveBeforeId.value = '';
};

const closeMoveEditor = () => {
  moveEditor.value = null;
  void nextTick(() => {
    if (moveReturnFocus?.isConnected) moveReturnFocus.focus();
    moveReturnFocus = null;
  });
};

const folderIsWithin = (candidateId: string, ancestorId: string): boolean => {
  let cursor = library.value.foldersById.get(candidateId);
  while (cursor?.parentId) {
    if (cursor.parentId === ancestorId) return true;
    cursor = library.value.foldersById.get(cursor.parentId);
  }
  return false;
};

const executeFolderMove = async (folderId: string) => {
  const folder = library.value.foldersById.get(folderId);
  if (!folder?.parentId) return null;
  if (folder.parentId === moveDestinationId.value) {
    return reorderFolder(folderId, moveBeforeId.value || undefined);
  }
  const source = sequenceFor(folder.parentId);
  const destination = sequenceFor(moveDestinationId.value);
  if (!source || !destination) return null;
  return stateModule.executeCommand({
    type: 'moveFolder',
    operationId: crypto.randomUUID(),
    folderId: folder.id,
    folderVersion: folder.version,
    sourceParentId: folder.parentId,
    destinationFolderId: moveDestinationId.value,
    expectedSourceFolderSequenceVersion: source.folderVersion,
    expectedDestinationFolderSequenceVersion: destination.folderVersion,
    ...(moveBeforeId.value ? { beforeFolderId: moveBeforeId.value } : {}),
  });
};

const executeBookmarkMove = async (bookmarkId: string) => {
  const bookmark = library.value.bookmarksById.get(bookmarkId);
  if (!bookmark) return null;
  if (bookmark.folderId === moveDestinationId.value) {
    return reorderBookmark(bookmarkId, moveBeforeId.value || undefined);
  }
  const source = sequenceFor(bookmark.folderId);
  const destination = sequenceFor(moveDestinationId.value);
  if (!source || !destination) return null;
  return stateModule.executeCommand({
    type: 'moveBookmark',
    operationId: crypto.randomUUID(),
    bookmarkId: bookmark.id,
    bookmarkVersion: bookmark.version,
    sourceFolderId: bookmark.folderId,
    destinationFolderId: moveDestinationId.value,
    expectedSourceBookmarkSequenceVersion: source.bookmarkVersion,
    expectedDestinationBookmarkSequenceVersion: destination.bookmarkVersion,
    ...(moveBeforeId.value ? { beforeBookmarkId: moveBeforeId.value } : {}),
  });
};

const moveEditorModel = computed(() => {
  const active = moveEditor.value;
  if (!active) return null;
  if (active.kind === 'folder') {
    return {
      noun: 'Folder',
      destinations: library.value.folders.filter(
        (folder) => folder.id !== active.id && !folderIsWithin(folder.id, active.id),
      ),
      positions: (library.value.foldersByParent.get(moveDestinationId.value) ?? [])
        .filter((folder) => folder.id !== active.id)
        .map((folder) => ({ id: folder.id, label: folder.name })),
      execute: () => executeFolderMove(active.id),
    };
  }
  return {
    noun: 'Bookmark',
    destinations: library.value.folders,
    positions: (library.value.bookmarksByFolder.get(moveDestinationId.value) ?? [])
      .filter((bookmark) => bookmark.id !== active.id)
      .map((bookmark) => ({ id: bookmark.id, label: bookmark.title })),
    execute: () => executeBookmarkMove(active.id),
  };
});

const saveMove = async () => {
  if (mutationPending.value) return;
  const result = await moveEditorModel.value?.execute();
  if (result?.status === 'acknowledged') closeMoveEditor();
};

const copyEditorValue = (value: BookmarkEditorValue): BookmarkEditorValue => ({
  ...value,
  ...(value.tags ? { tags: [...value.tags] } : {}),
});

const openFolderEditor = (folder?: BookmarkFolder) => {
  editorInitialValue.value = { name: folder?.name ?? '' };
  editorDraft.value = copyEditorValue(editorInitialValue.value);
  editor.value = { kind: 'folder', ...(folder ? { folder } : {}) };
};

const openBookmarkEditor = (bookmark?: Bookmark) => {
  editorInitialValue.value = {
    url: bookmark?.url ?? '',
    title: bookmark?.title ?? '',
    note: bookmark?.note ?? '',
    tags: bookmark ? [...(state.value.tagsByBookmark[bookmark.id] ?? [])] : [],
  };
  editorDraft.value = copyEditorValue(editorInitialValue.value);
  editor.value = { kind: 'bookmark', ...(bookmark ? { bookmark } : {}) };
};

const closeEditor = () => {
  editor.value = null;
  editorDraft.value = {};
  editorInitialValue.value = {};
};

const saveEditor = async (value: BookmarkEditorValue) => {
  if (mutationPending.value) return;
  const activeEditor = editor.value;
  const selectedFolder = state.value.selectedFolder;
  if (!activeEditor || !selectedFolder) return;
  let command: BookmarkCommand;
  if (activeEditor.kind === 'folder') {
    command = activeEditor.folder
      ? {
          type: 'editFolder',
          operationId: crypto.randomUUID(),
          folderId: activeEditor.folder.id,
          folderVersion: activeEditor.folder.version,
          name: value.name ?? '',
        }
      : {
          type: 'createFolder',
          operationId: crypto.randomUUID(),
          parentId: selectedFolder.id,
          expectedFolderSequenceVersion: selectedSequence.value?.folderVersion ?? 1,
          name: value.name ?? '',
        };
  } else {
    command = activeEditor.bookmark
      ? {
          type: 'editBookmark',
          operationId: crypto.randomUUID(),
          bookmarkId: activeEditor.bookmark.id,
          bookmarkVersion: activeEditor.bookmark.version,
          url: value.url ?? '',
          title: value.title ?? '',
          note: value.note ?? '',
          tags: value.tags ?? [],
        }
      : {
          type: 'createBookmark',
          operationId: crypto.randomUUID(),
          folderId: selectedFolder.id,
          expectedBookmarkSequenceVersion: selectedSequence.value?.bookmarkVersion ?? 1,
          url: value.url ?? '',
          title: value.title || undefined,
          note: value.note ?? '',
          tags: value.tags ?? [],
        };
  }
  const result = await stateModule.executeCommand(command);
  if (result?.status === 'acknowledged') {
    closeEditor();
  } else if (result?.status === 'conflict' && result.code === 'stale_entity') {
    if (activeEditor.kind === 'folder' && result.folders[0]) {
      openFolderEditor(result.folders[0]);
    } else if (activeEditor.kind === 'bookmark' && result.bookmarks[0]) {
      openBookmarkEditor(result.bookmarks[0]);
    }
  }
};

const openTrash = async () => {
  trashOpen.value = true;
  duplicatesOpen.value = false;
  editMode.value = false;
  await closeSearch();
  await stateModule.loadTrash();
};

const openDuplicates = async () => {
  duplicatesOpen.value = true;
  trashOpen.value = false;
  editMode.value = false;
  await closeSearch();
};

const revealExistingBookmark = async (bookmark: Bookmark) => {
  closeEditor();
  editMode.value = false;
  await navigateToFolder(bookmark.folderId);
  await nextTick();
  const card = document.querySelector<HTMLElement>(
    `.bookmark-card-shell[data-bookmark-id="${bookmark.id}"] .bookmark-card`,
  );
  card?.scrollIntoView({ block: 'center' });
  card?.focus();
};

const rememberUndoableTrash = (root: BookmarkTrashRoot, version: number) => {
  undoableTrash.value = { root, version };
};

const clearUndoableTrash = (rootId?: string) => {
  if (!rootId || undoableTrash.value?.root.id === rootId) undoableTrash.value = null;
};

const trashBookmark = async (bookmark: Bookmark) => {
  if (mutationPending.value) return;
  const sequence = sequenceFor(bookmark.folderId);
  if (!sequence) return;
  const result = await stateModule.executeCommand({
    type: 'trashBookmark',
    operationId: crypto.randomUUID(),
    bookmarkId: bookmark.id,
    bookmarkVersion: bookmark.version,
    folderId: bookmark.folderId,
    expectedBookmarkSequenceVersion: sequence.bookmarkVersion,
  });
  if (result?.status === 'acknowledged') {
    rememberUndoableTrash(
      {
        kind: 'bookmark',
        id: bookmark.id,
        deletedAt: new Date().toISOString(),
        originalParentId: bookmark.folderId,
        originalRank: bookmark.rank,
      },
      bookmark.version + 1,
    );
  }
};

const folderSubtreeCounts = (folderId: string) => {
  const ids = new Set([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of state.value.folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
    }
  }
  return {
    folders: ids.size - 1,
    bookmarks: state.value.bookmarks.filter((bookmark) => ids.has(bookmark.folderId)).length,
  };
};

const trashFolder = async (folder: BookmarkFolder) => {
  if (mutationPending.value) return;
  if (!folder.parentId) return;
  const sequence = sequenceFor(folder.parentId);
  if (!sequence) return;
  const contents = folderSubtreeCounts(folder.id);
  if (
    (contents.folders || contents.bookmarks) &&
    !window.confirm(
      `Move “${folder.name}” and its ${contents.folders} child Folders and ${contents.bookmarks} Bookmarks to Trash?`,
    )
  )
    return;
  const result = await stateModule.executeCommand({
    type: 'trashFolder',
    operationId: crypto.randomUUID(),
    folderId: folder.id,
    folderVersion: folder.version,
    parentId: folder.parentId,
    expectedFolderSequenceVersion: sequence.folderVersion,
  });
  if (result?.status === 'acknowledged') {
    rememberUndoableTrash(
      {
        kind: 'folder',
        id: folder.id,
        deletedAt: new Date().toISOString(),
        originalParentId: folder.parentId,
        originalRank: folder.rank,
      },
      folder.version + 1,
    );
  }
};

const trashRootVersion = (root: BookmarkTrashRoot) =>
  (root.kind === 'folder' ? state.value.trash?.folders : state.value.trash?.bookmarks)?.find(
    (item) => item.id === root.id,
  )?.version;

const restoreTrashRoot = async (root: BookmarkTrashRoot) => {
  if (mutationPending.value) return;
  const activeParent = library.value.foldersById.has(root.originalParentId)
    ? root.originalParentId
    : SYSTEM_ROOT_FOLDER_ID;
  const sequence = sequenceFor(activeParent);
  const version =
    trashRootVersion(root) ??
    (undoableTrash.value?.root.id === root.id ? undoableTrash.value.version : null);
  if (!sequence || !version) return;
  const result = await stateModule.executeCommand({
    type: 'restoreTrash',
    operationId: crypto.randomUUID(),
    rootKind: root.kind,
    rootId: root.id,
    rootVersion: version,
    expectedDestinationSequenceVersion:
      root.kind === 'folder' ? sequence.folderVersion : sequence.bookmarkVersion,
  });
  if (result?.status === 'acknowledged') clearUndoableTrash(root.id);
};

const purgeTrashRoot = async (root: BookmarkTrashRoot) => {
  if (mutationPending.value) return;
  const version = trashRootVersion(root);
  if (
    !version ||
    !window.confirm(
      'Permanently delete this item from authoritative storage? Disconnected snapshots and Owner-managed exports are not erased.',
    )
  )
    return;
  const result = await stateModule.executeCommand({
    type: 'purgeTrash',
    operationId: crypto.randomUUID(),
    rootKind: root.kind,
    rootId: root.id,
    rootVersion: version,
  });
  if (result?.status === 'acknowledged') clearUndoableTrash(root.id);
};

const emptyTrash = async () => {
  if (mutationPending.value) return;
  if (
    !state.value.trash ||
    !window.confirm(
      'Permanently delete every Trash item from authoritative storage? This cannot be undone.',
    )
  )
    return;
  const result = await stateModule.executeCommand({
    type: 'emptyTrash',
    operationId: crypto.randomUUID(),
    expectedRevision: state.value.trash.revision,
  });
  if (result?.status === 'acknowledged') clearUndoableTrash();
};

onMounted(async () => {
  recentChannel.addEventListener('message', syncRecentHistory);
  void syncRecentHistory();
  try {
    const storedSidebarWidth = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    if (Number.isFinite(storedSidebarWidth) && storedSidebarWidth > 0) {
      sidebarWidth.value = clampSidebarWidth(storedSidebarWidth);
    }
  } catch {
    // Use the default width when browser storage is unavailable.
  }
  desktopMedia = window.matchMedia('(min-width: 761px)');
  desktopMedia.addEventListener('change', updateDesktopEditing);
  updateDesktopEditing();
  document.addEventListener('keydown', handleGlobalKeydown);
  const folderId = props.legacyFolderId;
  unsubscribe = stateModule.subscribe((replacement) => {
    state.value = replacement;
    if (replacement.tagsByBookmark !== library.value.tagsByBookmark) library.value = replacement;
    if (!initialized.value && replacement.status !== 'loading') {
      initialized.value = true;
    }
  });
  if (folderId) emit('canonicalize');
  await stateModule.initialize(folderId ? { folderId } : undefined);
});

watch(
  () => props.legacyFolderId,
  async () => {
    if (!initialized.value) return;
    const folderId = props.legacyFolderId;
    if (!folderId) return;
    await stateModule.selectFolder(folderId);
    emit('canonicalize');
  },
);

onUnmounted(() => {
  recentDisposed = true;
  recentChannel.close();
  document.removeEventListener('keydown', handleGlobalKeydown);
  unsubscribe?.();
  stateModule.dispose();
  desktopMedia?.removeEventListener('change', updateDesktopEditing);
});
</script>

<template>
  <section
    class="bookmarks-page"
    :class="{ 'sidebar-resizing': resizingSidebar }"
    @click="recordLinkOpening"
    @auxclick="recordLinkOpening"
  >
    <button ref="mobileFolderButton" class="mobile-folder-button" type="button" @click="openDrawer">
      <span aria-hidden="true">☰</span> Folders
    </button>

    <aside
      id="folder-sidebar"
      class="folder-sidebar"
      aria-label="Folders"
      :style="{ width: `${sidebarWidth}px` }"
    >
      <div class="sidebar-heading">
        <h2>Folders</h2>
      </div>
      <FolderNavigation
        :children-by-parent="state.foldersByParent"
        :selected-folder-id="state.selectedFolder?.id"
        :expanded-folder-ids="state.expandedFolderIds"
        :bookmark-counts="folderBookmarkCounts"
        @select="navigateToFolder"
        @toggle="toggleFolder"
      />
      <button class="trash-navigation" type="button" @click="openDuplicates">
        Duplicates <span v-if="duplicateGroups.length">{{ duplicateGroups.length }}</span>
      </button>
      <button class="trash-navigation" type="button" @click="openTrash">Trash</button>
      <div
        class="sidebar-resizer"
        role="separator"
        aria-label="Resize Folder sidebar"
        aria-controls="folder-sidebar"
        aria-orientation="vertical"
        :aria-valuemin="SIDEBAR_MIN_WIDTH"
        :aria-valuemax="SIDEBAR_MAX_WIDTH"
        :aria-valuenow="sidebarWidth"
        tabindex="0"
        @keydown="resizeSidebarWithKeyboard"
        @pointerdown="startSidebarResize"
        @pointermove="resizeSidebar"
        @pointerup="finishSidebarResize"
        @pointercancel="finishSidebarResize"
        @lostpointercapture="finishSidebarResize"
      ></div>
    </aside>

    <div class="bookmarks-workspace">
      <p v-if="state.notice" class="navigation-notice" role="status">{{ state.notice }}</p>
      <div v-if="undoableTrash" class="undo-notice" role="status">
        <span>Moved to Trash.</span>
        <button
          type="button"
          :disabled="mutationPending"
          @click="restoreTrashRoot(undoableTrash.root)"
        >
          Undo
        </button>
      </div>

      <div
        v-if="state.writeStatus !== 'idle'"
        class="write-status"
        :class="state.writeStatus"
        role="status"
      >
        <span>{{ state.writeMessage }}</span>
        <button
          v-if="state.writeStatus === 'unknown' && state.unconfirmedOperations[0]"
          type="button"
          @click="stateModule.retryUnconfirmed(state.unconfirmedOperations[0].command.operationId)"
        >
          Retry same operation
        </button>
      </div>

      <div
        v-if="state.syncStatus !== 'idle'"
        class="sync-status"
        :class="state.syncStatus"
        role="status"
      >
        <span>
          <strong v-if="state.syncStatus === 'syncing'">Synchronizing…</strong>
          <strong v-else-if="state.syncStatus === 'slow'"
            >Synchronization is taking too long.</strong
          >
          <strong v-else-if="state.syncStatus === 'failed'">Synchronization failed.</strong>
          <strong v-else-if="state.snapshotRevision !== null"
            >Offline — showing retained Bookmarks.</strong
          >
          <strong v-else>Offline — an online load is required.</strong>
          <small>Last synchronized: {{ formatSyncTime(state.lastSuccessfulSyncAt) }}</small>
        </span>
        <button
          v-if="state.syncStatus === 'slow' || state.syncStatus === 'failed'"
          type="button"
          @click="stateModule.refresh()"
        >
          Retry
        </button>
      </div>

      <div v-if="!trashOpen && !duplicatesOpen" class="bookmark-search">
        <label class="visually-hidden" for="bookmark-search-input">Search Bookmarks</label>
        <div class="search-field">
          <input
            id="bookmark-search-input"
            ref="searchInput"
            type="search"
            :value="state.searchQuery"
            placeholder="Search titles, URLs, Tags, and Notes"
            autocomplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-controls="bookmark-search-results"
            :aria-expanded="searchOpen"
            :aria-activedescendant="selectedResultId"
            @input="updateSearch"
            @keydown="handleSearchKeydown"
          />
          <select
            class="search-scope-select"
            :value="state.searchScope"
            aria-label="Search scope"
            @change="updateSearchScope"
          >
            <option value="global">Everywhere</option>
            <option value="selected-folder">Current Folder</option>
          </select>
          <button
            class="search-filter-button"
            type="button"
            :aria-expanded="searchFiltersOpen"
            aria-controls="bookmark-search-filters"
            @click="searchFiltersOpen = !searchFiltersOpen"
          >
            Filters
            <span v-if="state.searchFilters.tags.length + state.searchFilters.domains.length">
              {{ state.searchFilters.tags.length + state.searchFilters.domains.length }}
            </span>
          </button>
          <kbd>/</kbd>
        </div>
        <div
          v-if="state.searchFilters.tags.length || state.searchFilters.domains.length"
          class="search-filter-chips"
          aria-label="Active search filters"
        >
          <button
            v-for="tag in state.searchFilters.tags"
            :key="`tag:${tag}`"
            type="button"
            @click="removeSearchFilter('tag', tag)"
          >
            Tag: {{ tag }} <span aria-hidden="true">×</span>
          </button>
          <button
            v-for="domain in state.searchFilters.domains"
            :key="`domain:${domain}`"
            type="button"
            @click="removeSearchFilter('domain', domain)"
          >
            Domain: {{ domain }} <span aria-hidden="true">×</span>
          </button>
        </div>
        <div v-if="searchFiltersOpen" id="bookmark-search-filters" class="search-filter-panel">
          <label>
            Tag
            <select v-model="selectedTagFacet" @change="addSearchFilter('tag', selectedTagFacet)">
              <option value="">Choose a Tag</option>
              <option
                v-for="facet in libraryFacets.tags"
                :key="facet.value"
                :value="facet.value"
                :disabled="state.searchFilters.tags.includes(facet.value)"
              >
                {{ facet.value }} ({{ facet.count }})
              </option>
            </select>
          </label>
          <label>
            Domain
            <select
              v-model="selectedDomainFacet"
              @change="addSearchFilter('domain', selectedDomainFacet)"
            >
              <option value="">Choose a domain</option>
              <option
                v-for="facet in libraryFacets.domains"
                :key="facet.value"
                :value="facet.value"
                :disabled="state.searchFilters.domains.includes(facet.value)"
              >
                {{ facet.value }} ({{ facet.count }})
              </option>
            </select>
          </label>
        </div>
        <div v-if="searchOpen" class="search-results">
          <p
            v-if="!state.searchResults.length"
            id="bookmark-search-results"
            class="search-empty"
            role="status"
          >
            No active Folders or Bookmarks match.
          </p>
          <ul v-else id="bookmark-search-results" role="listbox" aria-label="Search results">
            <li
              v-for="(result, index) in state.searchResults"
              :key="`${result.kind}:${result.id}`"
              role="presentation"
            >
              <button
                v-if="result.kind === 'folder'"
                :id="`search-result-${index}`"
                type="button"
                role="option"
                :aria-selected="index === selectedSearchResult"
                :class="{ selected: index === selectedSearchResult }"
                @mouseenter="selectedSearchResult = index"
                @click="closeSearch().then(() => navigateToFolder(result.folderId))"
              >
                <span class="folder-glyph" aria-hidden="true"></span>
                <span
                  ><strong>{{ result.title }}</strong
                  ><small>{{ result.folderPath }}</small></span
                >
              </button>
              <a
                v-else
                :id="`search-result-${index}`"
                :href="result.url"
                :data-open-bookmark-id="result.id"
                role="option"
                :aria-selected="index === selectedSearchResult"
                :class="{ selected: index === selectedSearchResult }"
                @mouseenter="selectedSearchResult = index"
              >
                <span aria-hidden="true">↗</span>
                <span
                  ><strong>{{ result.title }}</strong
                  ><small>{{ result.folderPath }}</small
                  ><small v-if="result.context" class="search-match"
                    ><span>{{ result.context.label }}</span> · {{ result.context.text }}</small
                  ></span
                >
              </a>
            </li>
          </ul>
          <p
            v-if="state.searchResults.length === BOOKMARK_SEARCH_RESULT_LIMIT"
            class="search-limit"
          >
            Showing the top {{ BOOKMARK_SEARCH_RESULT_LIMIT }} matches. Refine your search to narrow
            the results.
          </p>
        </div>
      </div>

      <BookmarksDuplicatesView
        v-if="duplicatesOpen"
        :groups="duplicateGroups"
        :folder-paths="folderPaths"
        :tags-by-bookmark="state.tagsByBookmark"
        :editable="editingAvailable"
        :pending="mutationPending"
        :format-sync-time="formatSyncTime"
        @close="duplicatesOpen = false"
        @show="revealExistingBookmark"
        @trash="trashBookmark"
      />
      <BookmarksTrashView
        v-else-if="trashOpen"
        :trash="state.trash"
        :status="state.trashStatus"
        :active-folders="library.folders"
        :editable="editingAvailable"
        :pending="mutationPending"
        :format-sync-time="formatSyncTime"
        @close="trashOpen = false"
        @empty="emptyTrash"
        @retry="stateModule.loadTrash()"
        @restore="restoreTrashRoot"
        @purge="purgeTrashRoot"
      />

      <div
        v-else-if="state.status === 'loading' && !state.coldLoadProgressVisible"
        class="cold-shell"
        aria-hidden="true"
      ></div>

      <div v-else-if="state.status === 'loading'" class="library-state" aria-live="polite">
        <h1 id="bookmarks-title">Growing your library</h1>
        <p>Loading Bookmarks…</p>
      </div>

      <div v-else-if="state.status === 'error'" class="library-state">
        <h1 id="bookmarks-title">The library could not be loaded</h1>
        <p v-if="state.syncStatus === 'offline'">
          Go online once to retain this private library for offline reading.
        </p>
        <p v-else-if="state.retainedSnapshotCompatibility === 'incompatible'">
          Retained data belongs to a different application format and was preserved without being
          opened.
        </p>
        <p v-else>Check your connection and try again.</p>
        <button type="button" @click="stateModule.refresh()">Try again</button>
      </div>

      <div v-else-if="state.status === 'not-found'" class="library-state">
        <h1 id="bookmarks-title">Folder not found</h1>
        <p>This Folder may have moved or been deleted.</p>
        <button type="button" @click="navigateToFolder(SYSTEM_ROOT_FOLDER_ID)">
          Return to Bookmarks
        </button>
      </div>

      <template v-else>
        <div
          v-if="!searchOpen && (pinnedBookmarks.length || recentBookmarks.length)"
          class="bookmark-shortcut-bar"
        >
          <PinnedBookmarks
            :bookmarks="pinnedBookmarks"
            :writable="pinWritable"
            @change="setBookmarkPin"
          />
          <RecentBookmarks :bookmarks="recentBookmarks" @clear="clearRecent" />
        </div>
        <nav v-if="state.breadcrumbs.length > 1" class="breadcrumb" aria-label="Breadcrumb">
          <template v-for="(folder, index) in state.breadcrumbs" :key="folder.id">
            <span v-if="index" aria-hidden="true">/</span>
            <button
              v-if="index < state.breadcrumbs.length - 1"
              type="button"
              @click="navigateToFolder(folder.id)"
            >
              {{ folder.name }}
            </button>
            <span v-else aria-current="page">{{ folder.name }}</span>
          </template>
        </nav>

        <header class="library-heading">
          <h1 id="bookmarks-title">{{ state.selectedFolder?.name || 'Bookmarks' }}</h1>
          <div class="library-actions">
            <span class="item-count">
              {{ state.directFolders.length }} Folders ·
              {{ state.directBookmarks.length }} Bookmarks
            </span>
            <div v-if="editingAvailable && !editMode" class="desktop-edit-controls">
              <button
                type="button"
                title="Keyboard shortcut: N"
                :disabled="mutationPending"
                @click="openBookmarkEditor()"
              >
                Add Bookmark
              </button>
              <button
                class="edit-mode-button"
                type="button"
                :disabled="mutationPending"
                @click="editMode = true"
              >
                Edit
              </button>
            </div>
            <div v-else-if="editingAvailable" class="desktop-edit-controls">
              <button type="button" :disabled="mutationPending" @click="openFolderEditor()">
                New Folder
              </button>
              <button type="button" :disabled="mutationPending" @click="openBookmarkEditor()">
                Add Bookmark
              </button>
              <button
                v-if="state.selectedFolder && state.selectedFolder.id !== SYSTEM_ROOT_FOLDER_ID"
                type="button"
                :disabled="mutationPending"
                @click="openFolderEditor(state.selectedFolder)"
              >
                Edit Folder
              </button>
              <button
                v-if="state.selectedFolder && state.selectedFolder.id !== SYSTEM_ROOT_FOLDER_ID"
                type="button"
                :disabled="mutationPending"
                @click="trashFolder(state.selectedFolder)"
              >
                Trash Folder
              </button>
              <button type="button" @click="editMode = false">Done</button>
            </div>
          </div>
        </header>

        <section
          v-if="state.directFolders.length"
          class="child-folders"
          aria-labelledby="folders-title"
        >
          <h2 id="folders-title">Folders</h2>
          <div class="folder-grid">
            <div
              v-for="(folder, index) in state.directFolders"
              :key="folder.id"
              class="folder-tile"
              :data-folder-id="folder.id"
              :draggable="editingAvailable && editMode && !mutationPending"
              @dragstart="!mutationPending && (dragged = { kind: 'folder', id: folder.id, index })"
              @dragover="
                editingAvailable && editMode && !mutationPending && $event.preventDefault()
              "
              @drop="
                editingAvailable &&
                editMode &&
                !mutationPending &&
                (dropFolder(folder.id, index, nextSiblingId($event, 'folderId')),
                $event.preventDefault())
              "
            >
              <span
                v-if="editingAvailable && editMode"
                class="drag-handle desktop-edit-controls"
                aria-label="Drag Folder"
                >⋮⋮</span
              >
              <button type="button" @click="navigateToFolder(folder.id)">
                <span class="folder-icon" aria-hidden="true"
                  ><span class="folder-glyph"></span
                ></span>
                <span>{{ folder.name }}</span>
              </button>
              <button
                v-if="editingAvailable && editMode"
                class="tile-edit desktop-edit-controls"
                type="button"
                :aria-label="`Edit ${folder.name}`"
                :disabled="mutationPending"
                @click="openFolderEditor(folder)"
              >
                Edit
              </button>
              <button
                v-if="editingAvailable && editMode"
                class="tile-move desktop-edit-controls"
                type="button"
                :aria-label="`Move ${folder.name}`"
                :disabled="mutationPending"
                @click="openMoveEditor('folder', folder.id)"
              >
                Move
              </button>
              <button
                v-if="editingAvailable && editMode"
                class="tile-delete desktop-edit-controls"
                type="button"
                :aria-label="`Move ${folder.name} to Trash`"
                :disabled="mutationPending"
                @click="trashFolder(folder)"
              >
                Trash
              </button>
            </div>
            <div
              v-if="editingAvailable && editMode"
              class="drop-at-end desktop-edit-controls"
              @dragover="!mutationPending && $event.preventDefault()"
              @drop="!mutationPending && (dropFolder(), $event.preventDefault())"
            >
              Drop to place last
            </div>
          </div>
        </section>

        <section
          v-if="state.directBookmarks.length"
          class="bookmark-section"
          aria-labelledby="saved-title"
        >
          <h2 id="saved-title">Bookmarks</h2>
          <div class="bookmark-grid">
            <BookmarkCard
              v-for="(bookmark, index) in state.directBookmarks"
              :key="bookmark.id"
              :bookmark="bookmark"
              :tags="state.tagsByBookmark[bookmark.id] ?? []"
              :editable="editingAvailable && editMode"
              :pin-writable="pinWritable"
              :pending="mutationPending"
              @pin="setBookmarkPin(bookmark.id, !bookmark.pinRank)"
              @edit="openBookmarkEditor(bookmark)"
              @move="openMoveEditor('bookmark', bookmark.id)"
              @remove="trashBookmark(bookmark)"
              @dragstart="dragged = { kind: 'bookmark', id: bookmark.id, index }"
              @drop="dropBookmark(bookmark.id, index, nextSiblingId($event, 'bookmarkId'))"
            />
            <div
              v-if="editingAvailable && editMode"
              class="drop-at-end desktop-edit-controls"
              @dragover="!mutationPending && $event.preventDefault()"
              @drop="!mutationPending && (dropBookmark(), $event.preventDefault())"
            >
              Drop to place last
            </div>
          </div>
        </section>

        <div
          v-if="!state.directFolders.length && !state.directBookmarks.length"
          class="library-state empty"
        >
          <h2>
            {{
              state.selectedFolder?.id === SYSTEM_ROOT_FOLDER_ID
                ? 'Your library is ready'
                : 'This Folder is empty'
            }}
          </h2>
          <p>
            {{
              state.selectedFolder?.id === SYSTEM_ROOT_FOLDER_ID
                ? 'Saved Folders and Bookmarks will appear here.'
                : 'There are no direct child Folders or Bookmarks here yet.'
            }}
          </p>
        </div>
      </template>
    </div>

    <div v-if="drawerOpen" class="drawer-backdrop" @click.self="closeDrawer">
      <div
        class="folder-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Folders"
        @keydown="trapDialogFocus"
        @keydown.esc.prevent="closeDrawer"
      >
        <div class="drawer-heading">
          <h2>Folders</h2>
          <button
            ref="drawerCloseButton"
            type="button"
            aria-label="Close Folder drawer"
            @click="closeDrawer"
          >
            ×
          </button>
        </div>
        <FolderNavigation
          :children-by-parent="state.foldersByParent"
          :selected-folder-id="state.selectedFolder?.id"
          :expanded-folder-ids="state.expandedFolderIds"
          :bookmark-counts="folderBookmarkCounts"
          @select="navigateToFolder"
          @toggle="toggleFolder"
        />
        <button
          class="trash-navigation"
          type="button"
          @click="
            drawerOpen = false;
            openDuplicates();
          "
        >
          Duplicates <span v-if="duplicateGroups.length">{{ duplicateGroups.length }}</span>
        </button>
        <button
          class="trash-navigation"
          type="button"
          @click="
            drawerOpen = false;
            openTrash();
          "
        >
          Trash
        </button>
      </div>
    </div>

    <BookmarkEditorModal
      v-if="
        editor && editingAvailable && (editMode || (editor.kind === 'bookmark' && !editor.bookmark))
      "
      :key="editorKey"
      :kind="editor.kind"
      :folder="editor.folder"
      :bookmark="editor.bookmark"
      :value="editorDraft"
      :initial-value="editorInitialValue"
      :saving="mutationPending"
      :destination-folder-name="state.selectedFolder?.name || 'Bookmarks'"
      :duplicate-bookmarks="editorDuplicateBookmarks"
      :duplicate-locations="duplicateLocations"
      :tag-suggestions="libraryFacets.tags.map((facet) => facet.value)"
      @close="closeEditor"
      @draft="editorDraft = $event"
      @reveal-bookmark="revealExistingBookmark"
      @save="saveEditor"
    />

    <BookmarkMoveModal
      v-if="moveEditorModel && editingAvailable && editMode"
      v-model:destination-id="moveDestinationId"
      v-model:before-id="moveBeforeId"
      :noun="moveEditorModel.noun"
      :destinations="moveEditorModel.destinations"
      :positions="moveEditorModel.positions"
      :pending="mutationPending"
      @close="closeMoveEditor"
      @save="saveMove"
    />
  </section>
</template>
