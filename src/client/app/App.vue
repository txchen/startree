<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch, type Component } from 'vue';

import BookmarksPage from '../bookmarks/BookmarksPage.vue';
import { resolvePagePath } from './routes';

import { createIndexedDbBookmarkAdapter } from '../bookmarks/bookmark-adapters';
import { clearLocalApplicationData } from './local-data';

const notesComponent = shallowRef<Component>();
const notesLoadFailed = ref(false);
const loadNotes = async () => {
  notesLoadFailed.value = false;
  try {
    notesComponent.value = (await import('../notes/NotesPage.vue')).default;
  } catch {
    notesLoadFailed.value = true;
  }
};
const notesPage = shallowRef<{ prepareToLeave(): Promise<boolean> }>();
const notesVisible = computed(() => /^\/notes\/?$/i.test(pathname.value));
const loggingOut = ref(false);
const pathname = shallowRef(window.location.pathname);
const page = computed(() => resolvePagePath(pathname.value));
watch(
  notesVisible,
  (visible) => {
    if (visible && !notesComponent.value) void loadNotes();
  },
  { immediate: true },
);
const updatePath = async () => {
  if (notesPage.value && !(await notesPage.value.prepareToLeave())) {
    window.history.pushState(null, '', pathname.value);
    return;
  }
  pathname.value = window.location.pathname;
};
const canonicalize = () => {
  window.history.replaceState(null, '', '/');
  updatePath();
};
const navigate = async (event: MouseEvent, destination: string) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  if (window.location.pathname === destination && !window.location.search && !window.location.hash)
    return;
  if (notesPage.value && !(await notesPage.value.prepareToLeave())) return;
  window.history.pushState(null, '', destination);
  pathname.value = destination;
};
onMounted(() => window.addEventListener('popstate', updatePath));
onUnmounted(() => window.removeEventListener('popstate', updatePath));

const clearAndLogOut = async () => {
  if (notesPage.value && !(await notesPage.value.prepareToLeave())) return;
  loggingOut.value = true;
  try {
    // Inspect encrypted drafts only on logout, never during Bookmark startup.
    const { createNotesStorage } = await import('../notes/notes-storage');
    const notesStorage = createNotesStorage();
    let hasDrafts = false;
    try {
      hasDrafts = (await notesStorage.read()).drafts.length > 0;
    } finally {
      await notesStorage.close();
    }
    if (
      hasDrafts &&
      !window.confirm(
        'Unsynced encrypted notes drafts are stored on this device. Logging out clears them. Cancel to sync or export them first.',
      )
    )
      return;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('startree-notes');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    await clearLocalApplicationData({
      clearIndexedDb: () => createIndexedDbBookmarkAdapter().clear(),
      cacheStorage: caches,
      serviceWorkerRegistrations: () => navigator.serviceWorker.getRegistrations(),
    });
    window.location.assign('/cdn-cgi/access/logout');
  } finally {
    loggingOut.value = false;
  }
};
</script>

<template>
  <div class="shell">
    <header class="app-bar">
      <a class="brand" href="/" aria-label="Startree home" @click="navigate($event, '/')">
        <img class="brand-mark" src="/brand-mark.svg" alt="" />
        <span>Startree</span>
      </a>
      <nav class="page-navigation" aria-label="Pages">
        <a
          href="/"
          :aria-current="!notesVisible ? 'page' : undefined"
          @click="navigate($event, '/')"
          >Bookmarks</a
        >
        <a
          href="/notes"
          :aria-current="notesVisible ? 'page' : undefined"
          @click="navigate($event, '/notes')"
          >Notes</a
        >
      </nav>
      <div class="session-actions">
        <button
          type="button"
          :disabled="loggingOut"
          aria-label="Clear local data and log out"
          @click="clearAndLogOut"
        >
          {{ loggingOut ? 'Clearing…' : 'Log out' }}
        </button>
      </div>
    </header>
    <main>
      <template v-if="notesVisible">
        <component :is="notesComponent" v-if="notesComponent" ref="notesPage" />
        <div v-else-if="notesLoadFailed" class="page-loading" role="alert">
          Notes could not be loaded. Connect and <button @click="loadNotes">try again</button>.
        </div>
        <p v-else class="page-loading" role="status">Loading Notes…</p>
      </template>
      <BookmarksPage
        v-else-if="page.matched"
        :legacy-folder-id="page.folderId"
        @canonicalize="canonicalize"
      />
    </main>
  </div>
</template>
