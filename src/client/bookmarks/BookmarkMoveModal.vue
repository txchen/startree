<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { BookmarkFolder } from '../../shared/bookmarks/contracts';
import { trapDialogFocus } from './dialog-focus';

defineProps<{
  noun: string;
  destinations: readonly BookmarkFolder[];
  positions: readonly { id: string; label: string }[];
  pending: boolean;
}>();
defineEmits<{ close: []; save: [] }>();
const destinationId = defineModel<string>('destinationId', { required: true });
const beforeId = defineModel<string>('beforeId', { required: true });
const destinationInput = ref<HTMLSelectElement>();

onMounted(() => destinationInput.value?.focus());
</script>

<template>
  <div class="move-backdrop" @click.self="$emit('close')">
    <div
      class="move-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-title"
      @keydown="trapDialogFocus"
      @keydown.esc.prevent="$emit('close')"
    >
      <h2 id="move-title">Move {{ noun }}</h2>
      <label>
        Destination Folder
        <select
          ref="destinationInput"
          v-model="destinationId"
          :disabled="pending"
          @change="beforeId = ''"
        >
          <option v-for="folder in destinations" :key="folder.id" :value="folder.id">
            {{ folder.name || 'Bookmarks' }}
          </option>
        </select>
      </label>
      <label>
        Position
        <select v-model="beforeId" :disabled="pending">
          <option value="">Append after existing items</option>
          <option v-for="item in positions" :key="item.id" :value="item.id">
            Before {{ item.label }}
          </option>
        </select>
      </label>
      <div class="move-dialog-actions">
        <button type="button" @click="$emit('close')">Cancel</button>
        <button type="button" :disabled="pending" @click="$emit('save')">Move</button>
      </div>
    </div>
  </div>
</template>
