<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, RouterView } from 'vue-router';

import { createIndexedDbBookmarkAdapter } from '../bookmarks/bookmark-adapters';
import { clearLocalApplicationData } from './local-data';
import { pageRoutes } from './routes';

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
        <span class="brand-mark" aria-hidden="true">✦</span>
        <span>Startree</span>
      </RouterLink>
      <nav aria-label="Pages">
        <RouterLink
          v-for="route in pageRoutes"
          :key="route.name?.toString()"
          class="nav-item"
          :to="route.path.replace('/:pathMatch(.*)*', '')"
        >
          {{ route.meta?.navLabel }}
        </RouterLink>
      </nav>
      <div class="session-actions">
        <span class="privacy-status"><span aria-hidden="true">●</span> Private</span>
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
