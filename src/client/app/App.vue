<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, RouterView } from 'vue-router';

import { createIndexedDbBookmarkAdapter } from '../bookmarks/bookmark-adapters';
import { clearLocalApplicationData } from './local-data';

const loggingOut = ref(false);

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
      <RouterLink class="brand" to="/bookmarks" aria-label="Startree home">
        <span>Startree</span>
      </RouterLink>
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
      <RouterView />
    </main>
  </div>
</template>
