<script setup lang="ts">
import { computed, ref } from 'vue';

import type { Bookmark } from '../../shared/bookmarks/contracts';

const props = defineProps<{
  bookmark: Bookmark;
  tags: readonly string[];
  editable: boolean;
}>();
defineEmits<{ edit: [] }>();

const faviconFailed = ref(false);
const destination = computed(() => new URL(props.bookmark.url));
const fallbackMark = computed(() => destination.value.hostname.charAt(0).toUpperCase() || '↗');
</script>

<template>
  <article class="bookmark-card-shell">
    <a class="bookmark-card" :href="bookmark.url">
      <span class="bookmark-favicon" aria-hidden="true">
        <img
          v-if="!faviconFailed"
          :src="`${destination.origin}/favicon.ico`"
          alt=""
          @error="faviconFailed = true"
        />
        <span v-else>{{ fallbackMark }}</span>
      </span>
      <span class="bookmark-copy">
        <strong>{{ bookmark.title }}</strong>
        <span class="bookmark-host">{{ destination.hostname }}</span>
        <span v-if="bookmark.note" class="bookmark-note">{{ bookmark.note }}</span>
        <span v-if="tags.length" class="bookmark-tags">
          <span v-for="tag in tags" :key="tag">{{ tag }}</span>
        </span>
      </span>
      <span class="bookmark-arrow" aria-hidden="true">↗</span>
    </a>
    <button
      v-if="editable"
      class="bookmark-edit-button desktop-edit-controls"
      type="button"
      :aria-label="`Edit ${bookmark.title}`"
      @click="$emit('edit')"
    >
      Edit
    </button>
  </article>
</template>
