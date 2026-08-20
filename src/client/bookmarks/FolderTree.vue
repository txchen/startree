<script setup lang="ts">
import { computed } from 'vue';

import type { BookmarkFolder } from '../../shared/bookmarks/contracts';

defineOptions({ name: 'FolderTree' });

const props = defineProps<{
  folders: readonly BookmarkFolder[];
  parentId: string;
  selectedFolderId?: string;
  expandedFolderIds: readonly string[];
  bookmarkCounts: Readonly<Record<string, number>>;
}>();

const emit = defineEmits<{
  select: [folderId: string];
  toggle: [folderId: string];
}>();

const children = computed(() =>
  props.folders
    .filter((folder) => folder.parentId === props.parentId)
    .sort((left, right) => left.rank.localeCompare(right.rank) || left.id.localeCompare(right.id)),
);

const hasChildren = (folderId: string) =>
  props.folders.some((folder) => folder.parentId === folderId);

const countLabel = (folderId: string) => {
  const count = props.bookmarkCounts[folderId] ?? 0;
  return `${count} ${count === 1 ? 'Bookmark' : 'Bookmarks'} including subfolders`;
};
</script>

<template>
  <ul v-if="children.length" class="folder-tree-list">
    <li v-for="folder in children" :key="folder.id">
      <div class="folder-tree-row" :class="{ selected: folder.id === selectedFolderId }">
        <button
          v-if="hasChildren(folder.id)"
          class="tree-toggle"
          type="button"
          :aria-label="`${expandedFolderIds.includes(folder.id) ? 'Collapse' : 'Expand'} ${folder.name}`"
          :aria-expanded="expandedFolderIds.includes(folder.id)"
          @click="emit('toggle', folder.id)"
        >
          {{ expandedFolderIds.includes(folder.id) ? '−' : '+' }}
        </button>
        <span v-else class="tree-spacer" aria-hidden="true"></span>
        <button
          class="tree-folder"
          type="button"
          :aria-label="`${folder.name}, ${countLabel(folder.id)}`"
          @click="emit('select', folder.id)"
        >
          <span class="folder-glyph" aria-hidden="true"></span>
          <span class="folder-name">{{ folder.name }}</span>
          <span class="folder-item-count" aria-hidden="true">
            {{ bookmarkCounts[folder.id] ?? 0 }}
          </span>
        </button>
      </div>
      <FolderTree
        v-if="expandedFolderIds.includes(folder.id)"
        :folders="folders"
        :parent-id="folder.id"
        :selected-folder-id="selectedFolderId"
        :expanded-folder-ids="expandedFolderIds"
        :bookmark-counts="bookmarkCounts"
        @select="emit('select', $event)"
        @toggle="emit('toggle', $event)"
      />
    </li>
  </ul>
</template>
