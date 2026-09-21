<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { Bookmark } from '../../shared/bookmarks/contracts';
import BookmarkFavicon from './BookmarkFavicon.vue';

defineProps<{ bookmarks: readonly Bookmark[] }>();
const emit = defineEmits<{ clear: [] }>();
const disclosure = ref<HTMLDetailsElement>();
const dismiss = (event: PointerEvent) => {
  if (
    event.target instanceof Node &&
    !disclosure.value?.contains(event.target) &&
    disclosure.value
  ) {
    disclosure.value.open = false;
  }
};
const close = () => {
  if (!disclosure.value) return;
  disclosure.value.open = false;
  disclosure.value.querySelector('summary')?.focus();
};
onMounted(() => document.addEventListener('pointerdown', dismiss));
onUnmounted(() => document.removeEventListener('pointerdown', dismiss));
</script>

<template>
  <details
    v-if="bookmarks.length"
    ref="disclosure"
    class="recent-disclosure"
    @keydown.esc.stop.prevent="close"
  >
    <summary>
      Recently opened <span>{{ bookmarks.length }}</span>
    </summary>
    <section class="bookmark-shortcuts recent-bookmarks" aria-labelledby="recent-title">
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
  </details>
</template>
