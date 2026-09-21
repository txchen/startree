<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';

import BookmarksPage from '../bookmarks/BookmarksPage.vue';
import NotesPrototype from '../NotesPrototype.vue';
const notesPrototype = import.meta.env.DEV && new URLSearchParams(location.search).has('notes-prototype');
import { resolvePagePath } from './routes';

import { createIndexedDbBookmarkAdapter } from '../bookmarks/bookmark-adapters';
import { clearLocalApplicationData } from './local-data';

const loggingOut = ref(false);
const pathname = shallowRef(window.location.pathname);
const page = computed(() => resolvePagePath(pathname.value));
const updatePath = () => {
  pathname.value = window.location.pathname;
};
const canonicalize = () => {
  window.history.replaceState(null, '', '/');
  updatePath();
};
const navigateHome = (event: MouseEvent) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  if (window.location.pathname !== '/' || window.location.search || window.location.hash) {
    window.history.pushState(null, '', '/');
    updatePath();
  }
};
onMounted(() => window.addEventListener('popstate', updatePath));
onUnmounted(() => window.removeEventListener('popstate', updatePath));

const clearAndLogOut = async () => {
  loggingOut.value = true;
  try {
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
    <header class="app-bar" :class="{ 'notes-prototype-shell': notesPrototype }">
      <a class="brand" href="/" aria-label="Startree home" @click="navigateHome">
        <img class="brand-mark" src="/brand-mark.svg" alt="" />
        <span>Startree</span>
      </a>
      <nav v-if="notesPrototype" class="prototype-page-nav"><a href="/">Bookmarks</a><a class="active" href="/?notes-prototype=1">Notes</a></nav>
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
      <NotesPrototype v-if="notesPrototype" />
      <BookmarksPage
        v-else-if="page.matched"
        :legacy-folder-id="page.folderId"
        @canonicalize="canonicalize"
      />
    </main>
  </div>
</template>

<style>
.app-bar.notes-prototype-shell { display:flex; align-items:center; height:54px; }
.prototype-page-nav { display:flex; gap:28px; margin-left:40px; margin-right:auto; align-self:stretch; align-items:center; font-size:13px; }.prototype-page-nav a { color:#82887f; text-decoration:none; height:100%; display:flex; align-items:center; border-bottom:2px solid transparent; }.prototype-page-nav .active { color:#365d49; border-color:#365d49; }
@media(max-width:760px){.prototype-page-nav {margin-left:24px; gap:16px; font-size:12px;}}
</style>
