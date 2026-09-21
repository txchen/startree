<script setup lang="ts">
import { ref } from 'vue';

import type { Bookmark } from '../../shared/bookmarks/contracts';

defineProps<{
  bookmarks: readonly Bookmark[];
  writable: boolean;
}>();
const emit = defineEmits<{
  change: [bookmarkId: string, pinned: boolean, beforeBookmarkId?: string];
}>();
const managing = ref(false);
</script>

<template>
  <section v-if="bookmarks.length" class="pinned-bookmarks" aria-labelledby="pinned-title">
    <header>
      <h2 id="pinned-title">Pinned</h2>
      <button
        type="button"
        :aria-expanded="managing"
        aria-controls="pinned-list"
        @click="managing = !managing"
      >
        {{ managing ? 'Done arranging' : 'Arrange pins' }}
      </button>
    </header>
    <ul id="pinned-list">
      <li v-for="(bookmark, index) in bookmarks" :key="bookmark.id" :data-pin-id="bookmark.id">
        <a :href="bookmark.url" :title="bookmark.title">
          <span aria-hidden="true">★</span>
          <span>{{ bookmark.title }}</span>
        </a>
        <div v-if="managing" class="pin-actions">
          <button
            type="button"
            :disabled="!writable || index === 0"
            :aria-label="`Move ${bookmark.title} earlier`"
            @click="emit('change', bookmark.id, true, bookmarks[index - 1]?.id)"
          >
            ←
          </button>
          <button
            type="button"
            :disabled="!writable || index === bookmarks.length - 1"
            :aria-label="`Move ${bookmark.title} later`"
            @click="emit('change', bookmark.id, true, bookmarks[index + 2]?.id)"
          >
            →
          </button>
          <button
            type="button"
            :disabled="!writable"
            :aria-label="`Unpin ${bookmark.title}`"
            @click="emit('change', bookmark.id, false)"
          >
            Unpin
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>
