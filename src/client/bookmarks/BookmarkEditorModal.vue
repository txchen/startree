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
}>();

const emit = defineEmits<{
  close: [];
  save: [value: BookmarkEditorValue];
  draft: [value: BookmarkEditorValue];
}>();

const firstInput = ref<HTMLInputElement>();
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

const submit = () => {
  emit('save', comparableValue());
};

watch([name, url, title, note, tags], () => emit('draft', comparableValue()));

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  requestClose();
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

      <form @submit.prevent="submit">
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
              @blur="fillHostname"
            />
          </label>
          <label>
            Title
            <input v-model="title" required maxlength="256" />
          </label>
          <label>
            Tags <small>Separate Tags with commas.</small>
            <input v-model="tags" />
          </label>
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
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </footer>
      </form>
    </section>
  </div>
</template>
