<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useTheme } from './theme';

const { selection, setTheme } = useTheme();
const palettes = ['Forest', 'Ocean', 'Dune', 'Dusk'];
const appearances = ['light', 'dark'];
const open = ref(false);
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const currentPalette = computed(() => selection.value.split(':')[0]);
const followsSystem = computed(() => selection.value.endsWith(':system'));
const currentLabel = computed(() => selection.value.replace(':', ' · '));
const close = (restoreFocus = false) => {
  open.value = false;
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
};
const toggle = async () => {
  open.value = !open.value;
  if (open.value) {
    await nextTick();
    const active = panel.value?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    (active ?? panel.value?.querySelector<HTMLButtonElement>('.theme-option'))?.focus();
  }
};
const choose = (value: string) => {
  setTheme(value);
  close(true);
};
const outside = (event: PointerEvent) => {
  if (event.target instanceof Node && !root.value?.contains(event.target)) close();
};
const leave = (event: FocusEvent) => {
  if (event.relatedTarget instanceof Node && !root.value?.contains(event.relatedTarget)) close();
};
const keydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close(true);
    return;
  }
  const buttons = [...(panel.value?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const lastIndex = buttons.length - 1;
  if (index < 0) return;
  const offsets: Record<string, number> = {
    ArrowRight: 1,
    ArrowLeft: -1,
    ArrowDown: 2,
    ArrowUp: -2,
  };
  const offset = offsets[event.key];
  let next: number;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = lastIndex;
  else if (offset === undefined) return;
  else if (event.key === 'ArrowDown') next = Math.min(index + offset, lastIndex);
  else next = (index + offset + buttons.length) % buttons.length;
  const target = buttons[next];
  if (!target || next === index) return;
  event.preventDefault();
  target.focus();
};
onMounted(() => document.addEventListener('pointerdown', outside));
onUnmounted(() => document.removeEventListener('pointerdown', outside));
</script>

<template>
  <div ref="root" class="theme-picker" @focusout="leave">
    <button
      ref="trigger"
      class="theme-trigger"
      type="button"
      :aria-label="`Theme: ${currentLabel}`"
      aria-haspopup="dialog"
      :aria-expanded="open"
      aria-controls="theme-picker-panel"
      :title="`Theme: ${currentLabel}`"
      @click="toggle"
      @keydown.esc="close(true)"
    >
      <span class="theme-trigger-colors" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>Theme</span>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 6 3 3 3-3" /></svg>
    </button>
    <section
      v-if="open"
      id="theme-picker-panel"
      ref="panel"
      class="theme-panel"
      role="dialog"
      aria-label="Choose a theme"
      @keydown="keydown"
    >
      <div class="theme-panel-heading">
        <strong>Choose a theme</strong><span>Light &amp; dark</span>
      </div>
      <div class="theme-options">
        <template v-for="palette in palettes" :key="palette">
          <button
            v-for="appearance in appearances"
            :key="appearance"
            type="button"
            class="theme-option"
            :data-theme-option="`${palette.toLowerCase()}:${appearance}`"
            :aria-label="`${palette} ${appearance}`"
            :aria-pressed="selection === `${palette.toLowerCase()}:${appearance}`"
            @click="choose(`${palette.toLowerCase()}:${appearance}`)"
          >
            <span
              class="theme-preview"
              :data-palette="palette.toLowerCase()"
              :data-appearance="appearance"
              aria-hidden="true"
            >
              <span class="theme-preview-sidebar"><i></i><i></i><i></i></span>
              <span class="theme-preview-content"
                ><i></i><span><i></i><i></i></span
              ></span>
              <span class="theme-preview-dot"></span>
            </span>
            <span class="theme-option-label"
              ><strong>{{ palette }}</strong
              ><span>{{ appearance }}</span
              ><svg
                v-if="selection === `${palette.toLowerCase()}:${appearance}`"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path d="m3 8 3 3 7-7" /></svg
            ></span>
          </button>
        </template>
      </div>
      <button
        type="button"
        class="theme-system"
        :aria-pressed="followsSystem"
        data-theme-system
        @click="choose(`${currentPalette}:system`)"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <rect x="3" y="3" width="14" height="10" rx="2" />
          <path d="M7 17h6m-3-4v4" />
        </svg>
        <span
          >Follow system<span>Keep {{ currentPalette }}, adapt to your device</span></span
        >
        <span class="theme-system-indicator" aria-hidden="true">{{
          followsSystem ? '✓' : ''
        }}</span>
      </button>
    </section>
  </div>
</template>
