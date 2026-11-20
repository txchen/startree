<script setup lang="ts">
import type { Bookmark } from '../../shared/bookmarks/contracts';
import type { BookmarkDuplicateGroup } from './bookmark-library';

defineProps<{
  groups: readonly BookmarkDuplicateGroup[];
  folderPaths: Readonly<Record<string, string>>;
  tagsByBookmark: Readonly<Record<string, readonly string[]>>;
  editable: boolean;
  pending: boolean;
  formatSyncTime: (value: string) => string;
}>();
defineEmits<{
  close: [];
  show: [bookmark: Bookmark];
  trash: [bookmark: Bookmark];
}>();
</script>

<template>
  <section class="duplicates-view" aria-labelledby="bookmarks-title">
    <header class="library-heading">
      <div>
        <span class="eyebrow">Library maintenance</span>
        <h1 id="bookmarks-title">Duplicate Bookmarks</h1>
      </div>
      <button type="button" @click="$emit('close')">Back to Bookmarks</button>
    </header>
    <div v-if="!groups.length" class="library-state empty">
      <h2>No duplicate URLs</h2>
      <p>Every active Bookmark currently has a distinct exact URL.</p>
    </div>
    <div v-else class="duplicate-groups">
      <article v-for="group in groups" :key="group.url" class="duplicate-group">
        <header>
          <strong>{{ group.url }}</strong>
          <span>{{ group.bookmarks.length }} Bookmarks</span>
        </header>
        <ul>
          <li v-for="bookmark in group.bookmarks" :key="bookmark.id">
            <div>
              <strong>
                <a :href="bookmark.url" :data-open-bookmark-id="bookmark.id">{{
                  bookmark.title
                }}</a>
              </strong>
              <small>{{ folderPaths[bookmark.folderId] ?? 'Bookmarks' }}</small>
              <small>
                Added {{ formatSyncTime(bookmark.createdAt) }}
                <template v-if="tagsByBookmark[bookmark.id]?.length">
                  · {{ tagsByBookmark[bookmark.id]?.join(', ') }}
                </template>
              </small>
              <p v-if="bookmark.note">{{ bookmark.note }}</p>
            </div>
            <div class="duplicate-actions">
              <button type="button" @click="$emit('show', bookmark)">Show</button>
              <button
                v-if="editable"
                type="button"
                :disabled="pending"
                @click="$emit('trash', bookmark)"
              >
                Move to Trash
              </button>
            </div>
          </li>
        </ul>
      </article>
    </div>
  </section>
</template>
