<script setup lang="ts">
import { computed, ref, watch } from 'vue';

const props = defineProps<{ url: string; title: string }>();
const origin = computed(() => new URL(props.url).origin);
const fallbackMark = computed(() => Array.from(props.title.trim())[0]?.toUpperCase() || '↗');
const failed = ref(false);
watch(origin, () => {
  failed.value = false;
});
</script>

<template>
  <span class="bookmark-favicon" aria-hidden="true">
    <img
      v-if="!failed"
      :key="origin"
      :src="`${origin}/favicon.ico`"
      alt=""
      width="18"
      height="18"
      loading="lazy"
      decoding="async"
      fetchpriority="low"
      referrerpolicy="no-referrer"
      @error="failed = true"
    />
    <span v-else>{{ fallbackMark }}</span>
  </span>
</template>
