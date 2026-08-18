<script setup lang="ts">
import type { BookmarkFolder } from '../../shared/bookmarks/contracts';
import { SYSTEM_ROOT_FOLDER_ID } from '../../shared/bookmarks/contracts';
import FolderTree from './FolderTree.vue';

defineProps<{
  folders: readonly BookmarkFolder[];
  selectedFolderId?: string;
  expandedFolderIds: readonly string[];
}>();

const emit = defineEmits<{
  select: [folderId: string];
  toggle: [folderId: string];
}>();
</script>

<template>
  <button
    class="root-folder"
    :class="{ selected: selectedFolderId === SYSTEM_ROOT_FOLDER_ID }"
    type="button"
    @click="emit('select', SYSTEM_ROOT_FOLDER_ID)"
  >
    <span aria-hidden="true">⌂</span> All Bookmarks
  </button>
  <FolderTree
    :folders="folders"
    :parent-id="SYSTEM_ROOT_FOLDER_ID"
    :selected-folder-id="selectedFolderId"
    :expanded-folder-ids="expandedFolderIds"
    @select="emit('select', $event)"
    @toggle="emit('toggle', $event)"
  />
</template>
