<script setup lang="ts">
import { computed } from 'vue';
import type {
  BookmarkFolder,
  BookmarkTrash,
  BookmarkTrashRoot,
} from '../../shared/bookmarks/contracts';
import { bookmarkFolderPaths } from './bookmark-library';
import type { BookmarkStateView } from './bookmark-state';

const props = defineProps<{
  trash: BookmarkTrash | null;
  status: BookmarkStateView['trashStatus'];
  activeFolders: readonly BookmarkFolder[];
  editable: boolean;
  pending: boolean;
  formatSyncTime: (value: string) => string;
}>();
defineEmits<{
  close: [];
  empty: [];
  retry: [];
  restore: [root: BookmarkTrashRoot];
  purge: [root: BookmarkTrashRoot];
}>();

const paths = computed(() =>
  bookmarkFolderPaths([...props.activeFolders, ...(props.trash?.folders ?? [])]),
);
const entries = computed(() => {
  if (!props.trash) return [];
  const names = new Map(props.trash.folders.map((folder) => [folder.id, folder.name]));
  const titles = new Map(props.trash.bookmarks.map((bookmark) => [bookmark.id, bookmark.title]));
  return props.trash.roots.map((root) =>
    root.kind === 'folder'
      ? { root, name: names.get(root.id), typeLabel: 'Folder tree' }
      : { root, name: titles.get(root.id), typeLabel: 'Bookmark' },
  );
});
</script>

<template>
  <section class="trash-view" aria-labelledby="bookmarks-title">
    <header class="library-heading">
      <h1 id="bookmarks-title">Trash</h1>
      <div class="trash-actions">
        <button type="button" @click="$emit('close')">Back to Bookmarks</button>
        <button
          v-if="editable && trash?.roots.length"
          type="button"
          :disabled="pending"
          @click="$emit('empty')"
        >
          Empty Trash
        </button>
      </div>
    </header>
    <div v-if="status === 'offline'" class="library-state empty">
      <h2>Trash is online only</h2>
      <p>Reconnect to review or change authoritative Trash. Offline snapshots do not include it.</p>
    </div>
    <div v-else-if="status === 'loading'" class="library-state empty">
      <p>Loading Trash…</p>
    </div>
    <div v-else-if="status === 'failed'" class="library-state empty">
      <h2>Trash could not be loaded</h2>
      <button type="button" @click="$emit('retry')">Try again</button>
    </div>
    <div v-else-if="!trash?.roots.length" class="library-state empty">
      <h2>Trash is empty</h2>
      <p>Deleted Bookmarks and Folder trees will appear here for 30 days.</p>
    </div>
    <ul v-else class="trash-list">
      <li v-for="entry in entries" :key="`${entry.root.kind}:${entry.root.id}`">
        <div>
          <strong>{{ entry.name }}</strong>
          <small
            >{{ entry.typeLabel }} · {{ paths[entry.root.originalParentId] ?? 'Bookmarks' }} ·
            Deleted {{ formatSyncTime(entry.root.deletedAt) }}</small
          >
        </div>
        <div v-if="editable">
          <button type="button" :disabled="pending" @click="$emit('restore', entry.root)">
            Restore</button
          ><button type="button" :disabled="pending" @click="$emit('purge', entry.root)">
            Delete permanently
          </button>
        </div>
      </li>
    </ul>
    <p v-if="trash?.roots.length" class="deletion-promise">
      Permanent deletion removes authoritative D1 records and future responses. It cannot erase
      disconnected browser snapshots or Owner-managed exports.
    </p>
  </section>
</template>
