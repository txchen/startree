<script setup lang="ts">
import { computed, ref } from 'vue';

import type { Bookmark } from '../../shared/bookmarks/contracts';

const props = defineProps<{
  bookmark: Bookmark;
  tags: readonly string[];
  editable: boolean;
}>();
const emit = defineEmits<{
  edit: [];
  move: [];
  remove: [];
  dragstart: [];
  drop: [event: DragEvent];
}>();

const faviconFailed = ref(false);
const destination = computed(() => new URL(props.bookmark.url));
const fallbackMark = computed(() => destination.value.hostname.charAt(0).toUpperCase() || '↗');

const activate = (event: MouseEvent) => {
  if (!props.editable) return;
  event.preventDefault();
  emit('edit');
};
</script>

<template>
  <article
    class="bookmark-card-shell"
    :data-bookmark-id="bookmark.id"
    :draggable="editable"
    @dragstart="emit('dragstart')"
    @dragover="editable && $event.preventDefault()"
    @drop="editable && (emit('drop', $event), $event.preventDefault())"
  >
    <span v-if="editable" class="drag-handle desktop-edit-controls" aria-label="Drag Bookmark"
      >⋮⋮</span
    >
    <a
      class="bookmark-card"
      :href="bookmark.url"
      :draggable="editable ? false : undefined"
      @click="activate"
    >
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
    <button
      v-if="editable"
      class="bookmark-move-button desktop-edit-controls"
      type="button"
      :aria-label="`Move ${bookmark.title}`"
      @click="emit('move')"
    >
      Move
    </button>
    <button
      v-if="editable"
      class="bookmark-delete-button desktop-edit-controls"
      type="button"
      :aria-label="`Move ${bookmark.title} to Trash`"
      @click="emit('remove')"
    >
      Trash
    </button>
  </article>
</template>
