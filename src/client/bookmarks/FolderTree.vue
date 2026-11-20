<script setup lang="ts">
import { computed } from 'vue';

import type { BookmarkFolder } from '../../shared/bookmarks/contracts';

defineOptions({ name: 'FolderTree' });

const props = defineProps<{
  childrenByParent: ReadonlyMap<string, readonly BookmarkFolder[]>;
  parentId: string;
  selectedFolderId?: string;
  expandedFolders: ReadonlySet<string>;
  bookmarkCounts: Readonly<Record<string, number>>;
}>();

const emit = defineEmits<{
  select: [folderId: string];
  toggle: [folderId: string];
}>();

const children = computed(() => props.childrenByParent.get(props.parentId) ?? []);

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
          v-if="childrenByParent.has(folder.id)"
          class="tree-toggle"
          type="button"
          :aria-label="`${expandedFolders.has(folder.id) ? 'Collapse' : 'Expand'} ${folder.name}`"
          :aria-expanded="expandedFolders.has(folder.id)"
          @click="emit('toggle', folder.id)"
        >
          {{ expandedFolders.has(folder.id) ? '−' : '+' }}
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
        v-if="expandedFolders.has(folder.id)"
        :children-by-parent="childrenByParent"
        :parent-id="folder.id"
        :selected-folder-id="selectedFolderId"
        :expanded-folders="expandedFolders"
        :bookmark-counts="bookmarkCounts"
        @select="emit('select', $event)"
        @toggle="emit('toggle', $event)"
      />
    </li>
  </ul>
</template>
