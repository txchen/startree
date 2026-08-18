<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { SYSTEM_ROOT_FOLDER_ID } from '../../shared/bookmarks/contracts';
import type { Bookmark, BookmarkCommand, BookmarkFolder } from '../../shared/bookmarks/contracts';
import BookmarkCard from './BookmarkCard.vue';
import BookmarkEditorModal from './BookmarkEditorModal.vue';
import { createFetchBookmarkAdapter, createIndexedDbBookmarkAdapter } from './bookmark-adapters';
import { createWorkerBookmarkSearchAdapter } from './bookmark-search';
import { createBookmarkState, type BookmarkStateView } from './bookmark-state';
import FolderNavigation from './FolderNavigation.vue';

const route = useRoute();
const router = useRouter();
const drawerOpen = ref(false);
const initialized = ref(false);
const searchInput = ref<HTMLInputElement>();
const selectedSearchResult = ref(0);
type EditorValue = {
  name?: string;
  url?: string;
  title?: string;
  note?: string;
  tags?: string[];
};
const editor = ref<{
  kind: 'folder' | 'bookmark';
  folder?: BookmarkFolder;
  bookmark?: Bookmark;
} | null>(null);
const editorDraft = ref<EditorValue>({});
const editorInitialValue = ref<EditorValue>({});
const desktopEditingAvailable = ref(false);
const editMode = ref(false);
const stateModule = createBookmarkState({
  remote: createFetchBookmarkAdapter(),
  storage: createIndexedDbBookmarkAdapter(),
  search: createWorkerBookmarkSearchAdapter(),
});
const state = shallowRef<BookmarkStateView>(stateModule.getState());
let unsubscribe: (() => void) | undefined;
let desktopMedia: MediaQueryList | undefined;
const updateDesktopEditing = () => {
  desktopEditingAvailable.value = desktopMedia?.matches ?? false;
};

const searchOpen = computed(() => state.value.searchQuery.trim().length > 0);
const editingAvailable = computed(
  () => desktopEditingAvailable.value && state.value.syncStatus !== 'offline',
);
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

const routeFolderId = (): string | undefined => {
  const value = route.params.pathMatch;
  const path = Array.isArray(value) ? value.join('/') : value;
  return path || undefined;
};

const folderLocation = (folderId: string) =>
  folderId === SYSTEM_ROOT_FOLDER_ID ? '/bookmarks' : `/bookmarks/${folderId}`;

const navigateToFolder = async (folderId: string) => {
  drawerOpen.value = false;
  await router.push(folderLocation(folderId));
};

const toggleFolder = async (folderId: string) => {
  await stateModule.toggleFolderExpanded(folderId);
};

const updateSearch = async (event: Event) => {
  selectedSearchResult.value = 0;
  await stateModule.search((event.target as HTMLInputElement).value);
};

const closeSearch = async () => {
  await stateModule.search('');
  selectedSearchResult.value = 0;
};

const activateSearchResult = async () => {
  const result = state.value.searchResults[selectedSearchResult.value];
  if (!result) return;
  if (result.kind === 'folder') {
    await closeSearch();
    await navigateToFolder(result.folderId);
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
    await activateSearchResult();
  }
};

const isFormControl = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

const handleGlobalKeydown = (event: KeyboardEvent) => {
  const shortcut = event.key === '/' || ((event.metaKey || event.ctrlKey) && event.key === 'k');
  if (!shortcut || isFormControl(event.target)) return;
  event.preventDefault();
  void nextTick(() => searchInput.value?.focus());
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

const copyEditorValue = (value: EditorValue): EditorValue => ({
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

const saveEditor = async (value: {
  name?: string;
  url?: string;
  title?: string;
  note?: string;
  tags?: string[];
}) => {
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

onMounted(async () => {
  desktopMedia = window.matchMedia('(min-width: 761px)');
  desktopMedia.addEventListener('change', updateDesktopEditing);
  updateDesktopEditing();
  document.addEventListener('keydown', handleGlobalKeydown);
  unsubscribe = stateModule.subscribe((replacement) => {
    state.value = replacement;
    const selectedFolderId = replacement.selectedFolder?.id;
    if (
      initialized.value &&
      replacement.status === 'ready' &&
      selectedFolderId &&
      (routeFolderId() ?? SYSTEM_ROOT_FOLDER_ID) !== selectedFolderId
    ) {
      void router.replace(folderLocation(selectedFolderId));
    }
  });
  const folderId = routeFolderId();
  await stateModule.initialize(folderId ? { folderId } : undefined);
  initialized.value = true;

  if (!folderId && state.value.selectedFolder?.id !== SYSTEM_ROOT_FOLDER_ID) {
    await router.replace(folderLocation(state.value.selectedFolder?.id ?? SYSTEM_ROOT_FOLDER_ID));
  }
});

watch(
  () => route.fullPath,
  async () => {
    if (!initialized.value) return;
    await stateModule.selectFolder(routeFolderId() ?? SYSTEM_ROOT_FOLDER_ID);
  },
);

onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  unsubscribe?.();
  stateModule.dispose();
  desktopMedia?.removeEventListener('change', updateDesktopEditing);
});
</script>

<template>
  <section class="bookmarks-page" aria-labelledby="bookmarks-title">
    <button class="mobile-folder-button" type="button" @click="drawerOpen = true">
      <span aria-hidden="true">☰</span> Folders
    </button>

    <aside class="folder-sidebar" aria-label="Folders">
      <div class="sidebar-heading">
        <span class="eyebrow">Library</span>
        <h2>Folders</h2>
      </div>
      <FolderNavigation
        :folders="state.folders"
        :selected-folder-id="state.selectedFolder?.id"
        :expanded-folder-ids="state.expandedFolderIds"
        @select="navigateToFolder"
        @toggle="toggleFolder"
      />
    </aside>

    <div class="bookmarks-workspace">
      <p v-if="state.notice" class="navigation-notice" role="status">{{ state.notice }}</p>

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

      <div class="bookmark-search">
        <label for="bookmark-search-input">Search every Folder and Bookmark</label>
        <div class="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            id="bookmark-search-input"
            ref="searchInput"
            type="search"
            :value="state.searchQuery"
            placeholder="Search titles, URLs, Tags, and Notes"
            autocomplete="off"
            role="combobox"
            aria-controls="bookmark-search-results"
            :aria-expanded="searchOpen"
            :aria-activedescendant="selectedResultId"
            @input="updateSearch"
            @keydown="handleSearchKeydown"
          />
          <kbd>/</kbd>
        </div>
        <div v-if="searchOpen" id="bookmark-search-results" class="search-results">
          <p v-if="!state.searchResults.length" class="search-empty">
            No active Folders or Bookmarks match.
          </p>
          <ul v-else>
            <li v-for="(result, index) in state.searchResults" :key="`${result.kind}:${result.id}`">
              <button
                v-if="result.kind === 'folder'"
                :id="`search-result-${index}`"
                type="button"
                :class="{ selected: index === selectedSearchResult }"
                @mouseenter="selectedSearchResult = index"
                @click="closeSearch().then(() => navigateToFolder(result.folderId))"
              >
                <span aria-hidden="true">⌑</span>
                <span
                  ><strong>{{ result.title }}</strong
                  ><small>{{ result.folderPath }}</small></span
                >
              </button>
              <a
                v-else
                :id="`search-result-${index}`"
                :href="result.url"
                :class="{ selected: index === selectedSearchResult }"
                @mouseenter="selectedSearchResult = index"
              >
                <span aria-hidden="true">↗</span>
                <span
                  ><strong>{{ result.title }}</strong
                  ><small>{{ result.folderPath }}</small></span
                >
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div
        v-if="state.status === 'loading' && !state.coldLoadProgressVisible"
        class="cold-shell"
        aria-hidden="true"
      ></div>

      <div v-else-if="state.status === 'loading'" class="library-state" aria-live="polite">
        <span class="state-mark" aria-hidden="true">⋯</span>
        <h1 id="bookmarks-title">Growing your library</h1>
        <p>Loading Bookmarks…</p>
      </div>

      <div v-else-if="state.status === 'error'" class="library-state">
        <span class="state-mark" aria-hidden="true">!</span>
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
        <span class="state-mark" aria-hidden="true">?</span>
        <h1 id="bookmarks-title">Folder not found</h1>
        <p>This Folder may have moved or been deleted.</p>
        <button type="button" @click="navigateToFolder(SYSTEM_ROOT_FOLDER_ID)">
          Return to Bookmarks
        </button>
      </div>

      <template v-else>
        <nav class="breadcrumb" aria-label="Breadcrumb">
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
          <div>
            <span class="eyebrow">Current Folder</span>
            <h1 id="bookmarks-title">{{ state.selectedFolder?.name || 'Bookmarks' }}</h1>
          </div>
          <div class="library-actions">
            <span class="item-count">
              {{ state.directFolders.length }} Folders ·
              {{ state.directBookmarks.length }} Bookmarks
            </span>
            <button
              v-if="editingAvailable && !editMode"
              class="edit-mode-button desktop-edit-controls"
              type="button"
              @click="editMode = true"
            >
              Edit
            </button>
            <div v-else-if="editingAvailable" class="desktop-edit-controls">
              <button type="button" @click="openFolderEditor()">New Folder</button>
              <button type="button" @click="openBookmarkEditor()">New Bookmark</button>
              <button
                v-if="state.selectedFolder && state.selectedFolder.id !== SYSTEM_ROOT_FOLDER_ID"
                type="button"
                @click="openFolderEditor(state.selectedFolder)"
              >
                Edit Folder
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
            <div v-for="folder in state.directFolders" :key="folder.id" class="folder-tile">
              <button type="button" @click="navigateToFolder(folder.id)">
                <span class="folder-icon" aria-hidden="true">⌑</span>
                <span>{{ folder.name }}</span>
                <span aria-hidden="true">→</span>
              </button>
              <button
                v-if="editingAvailable && editMode"
                class="tile-edit desktop-edit-controls"
                type="button"
                :aria-label="`Edit ${folder.name}`"
                @click="openFolderEditor(folder)"
              >
                Edit
              </button>
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
              v-for="bookmark in state.directBookmarks"
              :key="bookmark.id"
              :bookmark="bookmark"
              :tags="state.tagsByBookmark[bookmark.id] ?? []"
              :editable="editingAvailable && editMode"
              @edit="openBookmarkEditor(bookmark)"
            />
          </div>
        </section>

        <div
          v-if="!state.directFolders.length && !state.directBookmarks.length"
          class="library-state empty"
        >
          <span class="state-mark" aria-hidden="true">↗</span>
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

    <div v-if="drawerOpen" class="drawer-backdrop" @click.self="drawerOpen = false">
      <aside class="folder-drawer" role="dialog" aria-modal="true" aria-label="Folders">
        <div class="drawer-heading">
          <h2>Folders</h2>
          <button type="button" aria-label="Close Folder drawer" @click="drawerOpen = false">
            ×
          </button>
        </div>
        <FolderNavigation
          :folders="state.folders"
          :selected-folder-id="state.selectedFolder?.id"
          :expanded-folder-ids="state.expandedFolderIds"
          @select="navigateToFolder"
          @toggle="toggleFolder"
        />
      </aside>
    </div>

    <BookmarkEditorModal
      v-if="editor && editingAvailable && editMode"
      :key="editorKey"
      :kind="editor.kind"
      :folder="editor.folder"
      :bookmark="editor.bookmark"
      :value="editorDraft"
      :initial-value="editorInitialValue"
      :saving="state.writeStatus === 'pending'"
      @close="closeEditor"
      @draft="editorDraft = $event"
      @save="saveEditor"
    />
  </section>
</template>
