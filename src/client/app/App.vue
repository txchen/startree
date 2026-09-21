<script setup vapor lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';

import BookmarksPage from '../bookmarks/BookmarksPage.vue';
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
    <header class="app-bar">
      <a class="brand" href="/" aria-label="Startree home" @click="navigateHome">
        <img class="brand-mark" src="/brand-mark.svg" alt="" />
        <span>Startree</span>
      </a>
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
      <BookmarksPage
        v-if="page.matched"
        :legacy-folder-id="page.folderId"
        @canonicalize="canonicalize"
      />
    </main>
  </div>
</template>
