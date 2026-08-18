<script setup lang="ts">
import { computed } from 'vue';

import type { BookmarkFolder } from '../../shared/bookmarks/contracts';

defineOptions({ name: 'FolderTree' });

const props = defineProps<{
  folders: readonly BookmarkFolder[];
  parentId: string;
  selectedFolderId?: string;
  expandedFolderIds: readonly string[];
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
        <button class="tree-folder" type="button" @click="emit('select', folder.id)">
          <span aria-hidden="true">⌑</span>{{ folder.name }}
        </button>
      </div>
      <FolderTree
        v-if="expandedFolderIds.includes(folder.id)"
        :folders="folders"
        :parent-id="folder.id"
        :selected-folder-id="selectedFolderId"
        :expanded-folder-ids="expandedFolderIds"
        @select="emit('select', $event)"
        @toggle="emit('toggle', $event)"
      />
    </li>
  </ul>
</template>
