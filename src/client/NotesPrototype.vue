<script setup lang="ts">
// Throwaway UI study: three Notes layouts on the existing shell, using sample data only.
import { computed, onMounted, onUnmounted, ref } from 'vue';
const variants = ['A', 'B', 'C'];
const names = ['List & editor', 'Cards & detail', 'Focused writing'];
const variant = ref(new URLSearchParams(location.search).get('variant') || 'A');
const stage = ref('unlocked');
const query = ref('');
const selected = ref(0);
const editing = ref(false);
const picker = ref(false);
const menu = ref(false);
const saved = ref(true);
const notes = ref([
  { title: 'A quieter home screen', body: 'Keep the things I use every day within easy reach.\n\nA few ideas to come back to:\n\n• Bookmarks for places I want to revisit.\n• A private space for thoughts still taking shape.\n• Fewer panels. More room for the content.\n\nStart small. Keep only what feels useful.', time: 'Just now' },
  { title: 'Weekend ideas', body: 'Take the long route along the coast.\n\nBring a camera, a notebook, and no particular plan.\n\nFind a quiet place for lunch on the way back.', time: 'Today, 9:12 AM' },
  { title: 'Things to make', body: 'A small reading lamp.\nA better place for loose cables.\nA shelf beside the window.', time: 'Yesterday' },
  { title: 'Reading notes', body: 'Leave a little space after finishing a book.\n\nWrite down the one thought that stayed, before moving on to the next.', time: 'Sep 19' },
]);
const current = computed(() => notes.value[selected.value]);
const filtered = computed(() => notes.value.map((note, index) => ({ ...note, index })).filter(note => `${note.title} ${note.body}`.toLowerCase().includes(query.value.toLowerCase())));
const select = (index: number) => { selected.value = index; editing.value = true; picker.value = false; };
const add = () => { notes.value.unshift({ title: '', body: '', time: 'Just now' }); select(0); };
const cycle = (direction: number) => { variant.value = variants[(variants.indexOf(variant.value) + direction + 3) % 3]!; const url = new URL(location.href); url.searchParams.set('variant', variant.value); history.replaceState(null, '', url); editing.value = false; };
const keys = (event: KeyboardEvent) => { if ((event.target as HTMLElement)?.closest('input, textarea, [contenteditable]')) return; if (event.key === 'ArrowRight') cycle(1); if (event.key === 'ArrowLeft') cycle(-1); };
const changed = () => { saved.value = false; window.setTimeout(() => saved.value = true, 700); };
onMounted(() => document.addEventListener('keydown', keys));
onUnmounted(() => document.removeEventListener('keydown', keys));
</script>

<template>
  <div class="notes-prototype" :class="`variant-${variant}`">
    <header class="notes-heading">
      <div><h1>Notes <span class="private-label">Private</span></h1><p>A little space for your thoughts.</p></div>
      <div v-if="stage === 'unlocked'" class="notes-actions">
        <span class="session-label"><span class="status-dot"></span> Unlocked this session</span>
        <button @click="stage = 'locked'; menu = false">Lock now</button>
        <button aria-label="Notes settings" @click="menu = !menu">···</button>
        <div v-if="menu" class="settings-menu"><button @click="stage = 'setup'; menu = false">Password & recovery</button><p>Auto-lock after 15 minutes<br><small>Proposed default</small></p></div>
      </div>
    </header>

    <section v-if="stage !== 'unlocked'" class="unlock-area">
      <form v-if="stage === 'locked'" class="unlock-card" @submit.prevent="stage = 'unlocked'">
        <div class="lock-symbol"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/></svg></div><h2>Your notes are locked</h2>
        <p>Unlock once to read, write, and search.<br>Your bookmarks are always available.</p>
        <label>Notes password<input type="password" placeholder="Demo only — do not enter a real password" autocomplete="off"></label>
        <button class="primary">Unlock notes</button>
        <button type="button" class="text-button" @click="stage = 'recovery'">Use recovery key</button>
        <div class="privacy-copy">Titles and content are encrypted before syncing.<br>Refreshing this page locks your notes again.</div>
      </form>
      <form v-else-if="stage === 'setup'" class="unlock-card" @submit.prevent="stage = 'backup'">
        <div class="lock-symbol"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/></svg></div><h2>A private place to write</h2><p>Choose a separate password for your notes.<br>You will use it on each of your devices.</p>
        <label>Create notes password<input type="password" placeholder="Demo password" autocomplete="off"></label>
        <label>Confirm password<input type="password" placeholder="Repeat demo password" autocomplete="off"></label>
        <button class="primary">Continue to recovery key</button><div class="privacy-copy">Next: save a recovery key somewhere safe.<br>Your login cannot reset this encryption password.</div>
      </form>
      <div v-else-if="stage === 'backup'" class="unlock-card"><h2>Keep a way back in</h2><p>Save your recovery key outside Startree.<br>It can unlock your notes if you forget the password.</p><code class="sample-key">DEMO-KEY · NOT A REAL KEY</code><label class="check"><input type="checkbox"> I have saved my recovery key</label><button class="primary" @click="stage = 'unlocked'">Open notes</button><div class="privacy-copy">Without the password or recovery key,<br>your encrypted notes cannot be recovered.</div></div>
      <form v-else class="unlock-card" @submit.prevent="stage = 'setup'"><h2>Recover your notes</h2><p>Use your saved key to choose a new notes password.</p><label>Recovery key<textarea placeholder="Demo key only"></textarea></label><button class="primary">Continue</button><button type="button" class="text-button" @click="stage = 'locked'">Back to unlock</button></form>
    </section>

    <div v-else class="notes-layout" :class="{ 'mobile-editing': editing }">
      <aside v-if="variant === 'A' || variant === 'B' && !editing" class="note-list">
        <div class="list-toolbar"><input v-model="query" placeholder="Search notes" aria-label="Search notes"><button class="primary" @click="add">＋ New</button></div>
        <div class="list-caption">{{ filtered.length }} notes <span>Last edited ↓</span></div>
        <div class="note-items"><button v-for="note in filtered" :key="note.index" class="note-item" :class="{ selected: selected === note.index }" @click="select(note.index)"><strong>{{ note.title || 'Untitled note' }}</strong><p>{{ note.body || 'Start writing…' }}</p><small>{{ note.time }}</small></button></div>
        <p v-if="!filtered.length" class="no-results">No matching notes.</p>
        <div class="list-footer">Search stays on this device.</div>
      </aside>
      <section v-if="variant !== 'B' || editing" class="note-editor">
        <div class="editor-toolbar"><button v-if="variant === 'A'" class="mobile-back" @click="editing = false">← Notes</button><button v-if="variant === 'B'" @click="editing = false">← All notes</button>
          <div v-if="variant === 'C'" class="focus-picker"><button @click="picker = !picker">All notes · {{ notes.length }} ▾</button><div v-if="picker" class="picker-panel"><input v-model="query" placeholder="Find a note"><button v-for="note in filtered" :key="note.index" @click="select(note.index)">{{ note.title || 'Untitled note' }}</button></div><button @click="add">＋ New note</button></div>
          <span class="save-status"><span class="status-dot"></span> {{ saved ? 'Saved · demo' : 'Saving · demo' }}</span><button aria-label="Delete note" @click="notes.length > 1 && (notes.splice(selected, 1), selected = 0)">Delete</button>
        </div>
        <div class="writing-surface"><input v-model="current.title" class="note-title" placeholder="Untitled note" aria-label="Note title" @input="changed"><div class="note-date">September 21, 2026</div><textarea v-model="current.body" aria-label="Note content" placeholder="Start writing…" @input="changed"></textarea></div>
        <footer class="editor-footer"><span>Plain text</span><span>{{ current.body.length }} characters</span></footer>
      </section>
    </div>
    <div v-if="stage === 'unlocked'" class="session-footnote">Locks when you refresh · Auto-lock after 15 minutes of inactivity</div>
    <div class="prototype-controls"><div class="variant-switch"><button @click="cycle(-1)" aria-label="Previous concept">←</button><strong>{{ variant }} · {{ names[variants.indexOf(variant)] }}</strong><button @click="cycle(1)" aria-label="Next concept">→</button></div><div class="state-switch"><button @click="stage = 'unlocked'">Editor</button><button @click="stage = 'locked'">Locked</button><button @click="stage = 'setup'">First use</button></div><small>UI prototype · Sample data · No encryption or storage</small></div>
  </div>
</template>

<style>
.notes-prototype { --ink: #24332a; --muted: #798079; --line: #e2e6e2; --green: #365d49; max-width: 1440px; margin: auto; padding: 36px 44px 112px; color: var(--ink); }
.notes-prototype button { cursor: pointer; border: 1px solid var(--line); background: white; padding: 8px 12px; border-radius: 7px; color: #4c6053; font: inherit; font-size: 13px; }
.notes-prototype button:hover { background: #f1f5f1; }
.notes-prototype .primary { background: var(--green); color: white; border-color: var(--green); }
.notes-heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; }
.notes-heading h1 { font-size: 28px; letter-spacing: -.8px; margin: 0 0 8px; }
.notes-heading p { margin: 0; color: var(--muted); font-size: 14px; }
.private-label { display: inline-block; vertical-align: middle; font-size: 11px; font-weight: 500; letter-spacing: 0; color: #587160; background: #e8eee8; padding: 4px 8px; border-radius: 5px; margin-left: 9px; }
.notes-actions { display: flex; align-items: center; gap: 9px; position: relative; }.session-label { font-size: 12px; color: #718074; margin-right: 12px; }.status-dot { display: inline-block; width: 6px; height: 6px; background: #73947c; border-radius: 50%; margin-right: 5px; }
.notes-layout { display: grid; grid-template-columns: 286px minmax(0,1fr); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; min-height: 530px; background: white; }
.note-list { background: #fafbf9; border-right: 1px solid var(--line); display: flex; flex-direction: column; }.list-toolbar { display:flex; gap: 8px; padding: 18px 16px 14px; }.notes-prototype input:not([type=checkbox]),.notes-prototype textarea { font: inherit; outline-color: #7b9d84; color: var(--ink); }.list-toolbar input, .picker-panel input { min-width: 0; width: 100%; border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; background: white; font-size: 13px; }.list-toolbar button { white-space: nowrap; }.list-caption { display: flex; justify-content: space-between; font-size: 11px; color: #788277; padding: 0 18px 12px; }.note-items { padding: 0 8px; }.notes-prototype .note-item { display: block; text-align: left; width: 100%; border: 1px solid transparent; border-radius: 7px; padding: 15px 10px; margin-bottom: 4px; background: transparent; }.notes-prototype .note-item.selected { background: #eaf0e9; border-color: #d9e3d7; }.note-item strong { font-size: 13px; color: #314337; font-weight: 600; }.note-item p { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; margin: 7px 0 10px; color: #737c72; font-size: 12px; }.note-item small { font-size: 10px; color: #849081; }.list-footer { margin-top: auto; padding: 22px 18px; font-size: 11px; color: #889083; }.note-editor { min-width: 0; display: flex; flex-direction: column; }.editor-toolbar { min-height: 57px; padding: 12px 22px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #f0f1ee; }.editor-toolbar button { border: 0; font-size: 12px; padding: 4px 6px; }.save-status { margin-left: auto; font-size: 11px; color: #7a857a; }.writing-surface { padding: 35px 44px 18px; flex: 1; display: flex; flex-direction: column; }.notes-prototype input.note-title { border: 0; width: 100%; padding: 0; background: transparent; font-size: 28px; font-weight: 600; letter-spacing: -.6px; }.note-date { color: #93998f; font-size: 11px; margin: 12px 0 27px; }.writing-surface textarea { border: 0; background: transparent; width: 100%; flex: 1; min-height: 310px; resize: vertical; padding: 0; line-height: 1.95; font-size: 14px; color: #4b584c; }.editor-footer { display: flex; justify-content: space-between; padding: 14px 24px; font-size: 10px; color: #939b90; border-top: 1px solid #f3f4f1; }.session-footnote { text-align: right; font-size: 10px; color: #8c948b; margin-top: 12px; }.mobile-back { display: none; }.settings-menu { position: absolute; right: 0; top: 42px; background: white; box-shadow: 0 6px 24px #22332218; border: 1px solid var(--line); border-radius: 8px; padding: 12px; z-index: 4; }.settings-menu p { padding: 8px; font-size: 12px; line-height: 1.8; }.no-results { padding: 20px; font-size: 13px; }
.unlock-area { display: grid; place-items: center; min-height: 510px; }.unlock-card { width: min(390px, 100%); text-align: center; }.lock-symbol { margin: 0 auto 22px; width: 52px; height: 52px; display: grid; place-items: center; font-size: 34px; border: 1px solid #dae5da; border-radius: 15px; color: #46664f; background: #eaf0e8; }.unlock-card h2 { font-size: 24px; letter-spacing: -.5px; margin: 0 0 12px; }.unlock-card p { color: #7b8479; font-size: 13px; line-height: 1.8; margin-bottom: 26px; }.unlock-card label { display: block; text-align: left; font-size: 12px; margin: 16px 0; color: #53624f; }.unlock-card input:not([type=checkbox]),.unlock-card textarea { display: block; width: 100%; margin-top: 8px; padding: 12px; border: 1px solid #d9e1d6; border-radius: 7px; background: white; font-size: 12px; }.unlock-card > .primary { width: 100%; padding: 12px; }.unlock-card .text-button { border: 0; background: transparent; margin: 12px 0; font-size: 12px; }.privacy-copy { font-size: 11px; line-height: 1.9; color: #8b9487; border-top: 1px solid #e4e8e0; padding-top: 19px; margin-top: 15px; }.sample-key { display:block; padding:20px; background:white; border:1px dashed #a9b7a4; font-size:12px; }.check { line-height: 1.7; }
.variant-B .notes-layout { display: block; border: 0; background: transparent; }.variant-B .note-list { border: 0; background: transparent; }.variant-B .list-toolbar { padding: 0 0 20px; max-width: 460px; }.variant-B .list-caption { padding: 0 0 16px; }.variant-B .note-items { padding: 0; display: grid; grid-template-columns: repeat(3,1fr); gap: 18px; }.variant-B .note-item,.variant-B .note-item.selected { background: white; border: 1px solid var(--line); padding: 23px; min-height: 205px; }.variant-B .note-item p { white-space: pre-line; line-height: 1.8; height: 106px; }.variant-B .list-footer { padding-left:0; }.variant-B .note-editor { max-width: 860px; margin: auto; border: 1px solid var(--line); border-radius: 12px; background:white; }
.variant-C .notes-layout { display: block; max-width: 900px; margin: auto; }.variant-C .writing-surface { padding: 44px 64px 28px; }.variant-C .session-footnote { max-width: 900px; margin: 12px auto; }.focus-picker { display:flex; gap:10px; position:relative; }.picker-panel { position:absolute; top:32px; width:260px; padding:12px; background:white; border:1px solid var(--line); box-shadow:0 8px 24px #22332215; z-index:3; border-radius:8px; }.picker-panel button { display:block; margin-top:8px; }
.prototype-controls { position: fixed; bottom: 14px; left:50%; transform:translateX(-50%); background: #263b30; color:white; border:1px solid #466052; border-radius:14px; padding:8px 12px; z-index: 50; box-shadow:0 6px 24px #20352a24; display:grid; grid-template-columns:auto auto; align-items:center; gap:5px 16px; white-space:nowrap; }.prototype-controls button { border:0; background:transparent; color:#d3e1d5; padding:5px 8px; font-size:11px; }.prototype-controls button:hover { background:#40594a; }.variant-switch { display:flex; align-items:center; gap:9px; }.variant-switch strong { font-size:11px; min-width:132px; text-align:center; }.prototype-controls small { grid-column:1/-1; text-align:center; color:#a9bcae; font-size:9px; }.state-switch { border-left:1px solid #586b5e; padding-left:8px; }
@media(max-width:760px) { .notes-prototype { padding:24px 18px 122px; }.notes-heading { margin-bottom:20px; align-items:start; }.notes-heading h1 { font-size:23px; }.notes-heading p { font-size:12px; }.session-label { display:none; }.notes-actions { gap:5px; }.notes-layout { display:block; min-height:540px; }.variant-A .note-editor { display:none; }.variant-A .mobile-editing .note-list { display:none; }.variant-A .mobile-editing .note-editor { display:flex; }.note-list { min-height:540px; border:0; }.mobile-back { display:block; }.writing-surface,.variant-C .writing-surface { padding:26px 20px 20px; }.notes-prototype input.note-title { font-size:23px; }.writing-surface textarea { font-size:14px; min-height:330px; }.editor-toolbar { padding:12px; }.session-footnote { text-align:left; font-size:9px; }.variant-B .note-items { grid-template-columns:1fr; gap:10px; }.variant-B .note-item { min-height:170px; }.prototype-controls { gap:4px; padding:7px; grid-template-columns:1fr; }.prototype-controls small { grid-column:auto; }.state-switch { border:0; text-align:center; padding:0; }.unlock-area { min-height:500px; }.unlock-card h2 { font-size:22px; } }
</style>
