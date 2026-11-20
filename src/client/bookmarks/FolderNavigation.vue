<script setup lang="ts">
import { computed } from 'vue';

import type { BookmarkFolder } from '../../shared/bookmarks/contracts';
import { SYSTEM_ROOT_FOLDER_ID } from '../../shared/bookmarks/contracts';
import FolderTree from './FolderTree.vue';

const props = defineProps<{
  childrenByParent: ReadonlyMap<string, readonly BookmarkFolder[]>;
  selectedFolderId?: string;
  expandedFolderIds: readonly string[];
  bookmarkCounts: Readonly<Record<string, number>>;
}>();

const emit = defineEmits<{
  select: [folderId: string];
  toggle: [folderId: string];
}>();

const expandedFolders = computed(() => new Set(props.expandedFolderIds));

const rootBookmarkCount = (counts: Readonly<Record<string, number>>) =>
  counts[SYSTEM_ROOT_FOLDER_ID] ?? 0;
</script>

<template>
  <button
    class="root-folder"
    :class="{ selected: selectedFolderId === SYSTEM_ROOT_FOLDER_ID }"
    type="button"
    :aria-label="`All Bookmarks, ${rootBookmarkCount(bookmarkCounts)} Bookmarks including subfolders`"
    @click="emit('select', SYSTEM_ROOT_FOLDER_ID)"
  >
    <span aria-hidden="true">⌂</span>
    <span class="folder-name">All Bookmarks</span>
    <span class="folder-item-count" aria-hidden="true">
      {{ rootBookmarkCount(bookmarkCounts) }}
    </span>
  </button>
  <FolderTree
    :children-by-parent="childrenByParent"
    :parent-id="SYSTEM_ROOT_FOLDER_ID"
    :selected-folder-id="selectedFolderId"
    :expanded-folders="expandedFolders"
    :bookmark-counts="bookmarkCounts"
    @select="emit('select', $event)"
    @toggle="emit('toggle', $event)"
  />
</template>
