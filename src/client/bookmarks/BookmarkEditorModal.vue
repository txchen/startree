<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import {
  bookmarkTitleFor,
  type Bookmark,
  type BookmarkFolder,
} from '../../shared/bookmarks/contracts';
import type { BookmarkEditorValue } from './bookmark-editor';
import { trapDialogFocus } from './dialog-focus';

const props = defineProps<{
  kind: 'folder' | 'bookmark';
  folder?: BookmarkFolder;
  bookmark?: Bookmark;
  value: BookmarkEditorValue;
  initialValue: BookmarkEditorValue;
  saving: boolean;
  destinationFolderName?: string;
  duplicateBookmarks?: readonly Bookmark[];
  duplicateLocations?: Readonly<Record<string, string>>;
  tagSuggestions?: readonly string[];
}>();

const emit = defineEmits<{
  close: [];
  save: [value: BookmarkEditorValue];
  draft: [value: BookmarkEditorValue];
  revealBookmark: [bookmark: Bookmark];
}>();

const firstInput = ref<HTMLInputElement>();
const tagInput = ref<HTMLInputElement>();
const form = ref<HTMLFormElement>();
const name = ref(props.value.name ?? '');
const url = ref(props.value.url ?? '');
const title = ref(props.value.title ?? '');
const note = ref(props.value.note ?? '');
const tags = ref(props.value.tags?.join(', ') ?? '');
const discardPrompt = ref(false);
let returnFocus: HTMLElement | null = null;
const comparableValue = (): BookmarkEditorValue =>
  props.kind === 'folder'
    ? { name: name.value }
    : {
        url: url.value,
        title: title.value,
        note: note.value,
        tags: tags.value.trim() ? tags.value.split(',').map((tag) => tag.trim()) : [],
      };
const dirty = computed(
  () => JSON.stringify(comparableValue()) !== JSON.stringify(props.initialValue),
);
const heading = computed(() =>
  props.kind === 'folder'
    ? props.folder
      ? 'Edit Folder'
      : 'Create Folder'
    : props.bookmark
      ? 'Edit Bookmark'
      : 'Create Bookmark',
);
const selectedTagKeys = computed(
  () =>
    new Set(
      tags.value
        .split(',')
        .map((tag) => tag.trim().toLocaleLowerCase())
        .filter(Boolean),
    ),
);
const availableTagSuggestions = computed(() =>
  (props.tagSuggestions ?? [])
    .filter((tag) => !selectedTagKeys.value.has(tag.toLocaleLowerCase()))
    .slice(0, 8),
);

const requestClose = () => {
  if (props.saving) return;
  if (dirty.value) {
    discardPrompt.value = true;
    return;
  }
  emit('close');
};

const fillHostname = () => {
  if (title.value.trim() || !URL.canParse(url.value)) return;
  const destination = new URL(url.value);
  if (['http:', 'https:'].includes(destination.protocol)) {
    title.value = bookmarkTitleFor(url.value);
  }
};

const fillHostnameAfterPaste = () => {
  void nextTick(fillHostname);
};

const addSuggestedTag = (tag: string) => {
  tags.value = tags.value.trim() ? `${tags.value.replace(/\s*$/, '')}, ${tag}` : tag;
  void nextTick(() => tagInput.value?.focus());
};

const submit = () => {
  emit('save', comparableValue());
};

watch([name, url, title, note, tags], () => emit('draft', comparableValue()));

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    requestClose();
  } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    form.value?.requestSubmit();
  }
};

onMounted(() => {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.addEventListener('keydown', handleKeydown);
  void nextTick(() => firstInput.value?.focus());
});
onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  if (returnFocus?.isConnected) returnFocus.focus();
});
</script>

<template>
  <div class="editor-backdrop" @click.self="requestClose">
    <section
      class="bookmark-editor"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="'editor-title'"
      @keydown="trapDialogFocus"
    >
      <header>
        <div>
          <span class="eyebrow">Bookmarks Editor</span>
          <h2 id="editor-title">{{ heading }}</h2>
        </div>
        <button type="button" aria-label="Close editor" :disabled="saving" @click="requestClose">
          ×
        </button>
      </header>

      <form ref="form" @submit.prevent="submit">
        <label v-if="kind === 'folder'">
          Folder name
          <input ref="firstInput" v-model="name" required maxlength="256" />
        </label>
        <template v-else>
          <label>
            URL
            <input
              ref="firstInput"
              v-model="url"
              type="url"
              required
              maxlength="8192"
              @paste="fillHostnameAfterPaste"
              @blur="fillHostname"
            />
          </label>
          <p v-if="!bookmark && destinationFolderName" class="editor-destination">
            Saving to <strong>{{ destinationFolderName }}</strong>
          </p>
          <div v-if="duplicateBookmarks?.length" class="duplicate-warning" role="status">
            <strong>This URL is already saved.</strong>
            <p>You can open an existing Bookmark or save another copy.</p>
            <ul>
              <li v-for="existing in duplicateBookmarks" :key="existing.id">
                <span>
                  {{ existing.title }}
                  <small>{{ duplicateLocations?.[existing.id] ?? 'Bookmarks' }}</small>
                </span>
                <button type="button" @click="emit('revealBookmark', existing)">Show</button>
              </li>
            </ul>
          </div>
          <label>
            Title
            <input v-model="title" required maxlength="256" />
          </label>
          <label>
            Tags <small>Separate Tags with commas.</small>
            <input ref="tagInput" v-model="tags" />
          </label>
          <div v-if="availableTagSuggestions.length" class="tag-suggestions">
            <span>Suggestions</span>
            <button
              v-for="suggestion in availableTagSuggestions"
              :key="suggestion"
              type="button"
              @click="addSuggestedTag(suggestion)"
            >
              {{ suggestion }}
            </button>
          </div>
          <label>
            Note
            <textarea v-model="note" maxlength="32768" rows="7"></textarea>
          </label>
        </template>

        <div v-if="discardPrompt" class="discard-prompt" role="alert">
          <p>Discard your unsaved changes?</p>
          <button type="button" @click="discardPrompt = false">Keep editing</button>
          <button type="button" @click="emit('close')">Discard</button>
        </div>

        <footer>
          <button type="button" :disabled="saving" @click="requestClose">Cancel</button>
          <button class="primary" type="submit" :disabled="saving">
            {{ saving ? 'Saving…' : 'Save' }}<kbd v-if="!saving">Ctrl/⌘ ↵</kbd>
          </button>
        </footer>
      </form>
    </section>
  </div>
</template>
