<script setup lang="ts">
import type { Bookmark } from '../../shared/bookmarks/contracts';
import BookmarkFavicon from './BookmarkFavicon.vue';

defineProps<{ bookmarks: readonly Bookmark[] }>();
const emit = defineEmits<{ clear: [] }>();
</script>

<template>
  <section
    v-if="bookmarks.length"
    class="bookmark-shortcuts recent-bookmarks"
    aria-labelledby="recent-title"
  >
    <header>
      <h2 id="recent-title">Recently opened</h2>
      <button type="button" title="Clear recent Bookmarks in this browser" @click="emit('clear')">
        Clear recent
      </button>
    </header>
    <ul>
      <li v-for="bookmark in bookmarks" :key="bookmark.id" :data-recent-id="bookmark.id">
        <a
          :href="bookmark.url"
          :data-open-bookmark-id="bookmark.id"
          :title="[bookmark.url, bookmark.note].filter(Boolean).join('\n')"
        >
          <BookmarkFavicon :url="bookmark.url" :title="bookmark.title" />
          <span class="pinned-title">{{ bookmark.title }}</span>
        </a>
      </li>
    </ul>
  </section>
</template>
