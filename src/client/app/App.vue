<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';

import { pageRoutes } from './routes';
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
      <span class="privacy-status"><span aria-hidden="true">●</span> Private</span>
    </header>
    <main>
      <RouterView />
    </main>
  </div>
</template>
