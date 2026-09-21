<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { createNotesSession } from './notes-session';

const session = createNotesSession();
const { state } = session;
const query = ref('');
const selectedId = ref('');
const mobileEditor = ref(false);
const password = ref('');
const confirmation = ref('');
const recoveryMode = ref(false);
const selectedDraft = ref('');
const recoveryKey = ref('');
const recoveryCheck = ref('');
const setupOpen = ref(false);
const settingsOpen = ref(false);
const formBusy = ref(false);
const shielded = ref(false);
const fileInput = ref<HTMLInputElement>();
const current = computed(
  () => state.notes.find((note) => note.id === selectedId.value) ?? state.notes[0],
);
const filtered = computed(() =>
  state.notes
    .filter((note) =>
      `${note.title}\n${note.body}`.toLocaleLowerCase().includes(query.value.toLocaleLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
);
const settingUp = computed(() => state.phase === 'setup' || setupOpen.value);
const clearSecrets = () => {
  password.value = '';
  confirmation.value = '';
  recoveryCheck.value = '';
  recoveryKey.value = '';
  query.value = '';
  // Replace cached computed values so locked sessions do not retain old note references.
  void current.value;
  void filtered.value;
  setupOpen.value = false;
  settingsOpen.value = false;
  recoveryMode.value = false;
  shielded.value = false;
};
watch(
  () => state.phase,
  (phase, previous) => {
    if (phase === 'locked' && previous === 'unlocked') clearSecrets();
  },
);
const enter = async () => {
  formBusy.value = true;
  const secret = password.value;
  password.value = '';
  const recover = recoveryMode.value;
  if (await session.unlock(secret, recover, selectedDraft.value || undefined)) {
    lastActivity = Date.now();
    recoveryMode.value = false;
    selectedId.value = state.notes[0]?.id ?? '';
    mobileEditor.value = false;
    if (recover) setupOpen.value = true;
    else void session.refresh();
  }
  formBusy.value = false;
};
const beginSetup = async () => {
  if (password.value !== confirmation.value) {
    state.error = 'The passwords do not match.';
    return;
  }
  formBusy.value = true;
  const secret = password.value;
  password.value = confirmation.value = '';
  const recovery = await session.beginSetup(secret);
  if (recovery) recoveryKey.value = recovery;
  formBusy.value = false;
};
const finishSetup = async () => {
  formBusy.value = true;
  const check = recoveryCheck.value;
  recoveryCheck.value = '';
  if (await session.confirmSetup(check)) {
    lastActivity = Date.now();
    clearSecrets();
    selectedId.value = state.notes[0]?.id ?? '';
  }
  formBusy.value = false;
};
const lock = async () => {
  if (formBusy.value) return false;
  formBusy.value = true;
  const success = await session.lock();
  if (success) {
    clearSecrets();
    mobileEditor.value = false;
    selectedId.value = '';
    selectedDraft.value = '';
  }
  formBusy.value = false;
  return success;
};
defineExpose({ prepareToLeave: lock });
const add = () => {
  if (state.notes.length >= 500) {
    state.error = 'This notebook can hold up to 500 notes.';
    return;
  }
  const note = {
    id: crypto.randomUUID(),
    title: '',
    body: '',
    updatedAt: new Date().toISOString(),
  };
  state.notes.unshift(note);
  selectedId.value = note.id;
  query.value = '';
  mobileEditor.value = true;
  session.changed();
};
const changed = () => {
  if (current.value) current.value.updatedAt = new Date().toISOString();
  session.changed();
};
const remove = () => {
  if (
    !current.value ||
    !window.confirm(
      'Delete this note? This will also remove it from your other devices after syncing.',
    )
  )
    return;
  state.notes = state.notes.filter((note) => note.id !== current.value?.id);
  selectedId.value = state.notes[0]?.id ?? '';
  session.changed();
};
const download = (content: string, filename: string) => {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const exportEncrypted = async () => {
  try {
    const data = await session.encryptedExport();
    if (data) download(JSON.stringify(data), 'startree-notes-encrypted.json');
  } catch {
    state.error = 'The encrypted backup could not be created. Check the note size and try again.';
  }
};
const importEncrypted = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 1_048_576) throw new Error();
    await session.importEncrypted(JSON.parse(await file.text()));
    selectedDraft.value = state.drafts[0]?.id ?? '';
    state.error = '';
  } catch {
    state.error = 'This file is not a supported encrypted notes backup.';
  }
  input.value = '';
};
const useCloud = async () => {
  if (!(await lock())) return;
  await session.initialize();
  selectedDraft.value = '';
};
const dropDraft = async () => {
  if (selectedDraft.value && window.confirm('Permanently discard this encrypted local draft?')) {
    await session.removeDraft(selectedDraft.value);
    selectedDraft.value = '';
  }
};
let lastActivity = Date.now();
let interval: ReturnType<typeof setInterval>;
let locking = false;
const autoLock = async () => {
  if (
    locking ||
    shielded.value ||
    formBusy.value ||
    state.phase !== 'unlocked' ||
    Date.now() - lastActivity < 15 * 60_000
  )
    return;
  locking = true;
  shielded.value = true;
  await lock();
  locking = false;
};
const resumeHidden = async () => {
  formBusy.value = true;
  const secret = password.value;
  password.value = '';
  if (await session.verifySessionPassword(secret)) {
    lastActivity = Date.now();
    shielded.value = false;
  } else state.error = 'The password could not unlock these notes.';
  formBusy.value = false;
};
const activity = () => {
  if (shielded.value) return;
  if (state.phase !== 'unlocked') {
    lastActivity = Date.now();
    return;
  }
  if (Date.now() - lastActivity >= 15 * 60_000) void autoLock();
  else lastActivity = Date.now();
};
const visibility = () => {
  if (!document.hidden) void autoLock();
};
const beforeUnload = (event: BeforeUnloadEvent) => {
  if (!state.localSafe) {
    event.preventDefault();
    event.returnValue = '';
  }
};
const pageHide = () => {
  session.forget();
  clearSecrets();
};
const online = () => {
  void session.refresh();
};
onMounted(() => {
  void session.initialize();
  window.addEventListener('beforeunload', beforeUnload);
  window.addEventListener('pagehide', pageHide);
  window.addEventListener('online', online);
  document.addEventListener('visibilitychange', visibility);
  interval = setInterval(() => {
    void autoLock();
    if (!document.hidden) void session.refresh();
  }, 20_000);
});
onUnmounted(() => {
  clearInterval(interval);
  clearSecrets();
  void session.dispose();
  window.removeEventListener('beforeunload', beforeUnload);
  window.removeEventListener('pagehide', pageHide);
  window.removeEventListener('online', online);
  document.removeEventListener('visibilitychange', visibility);
});
</script>

<template>
  <section
    class="notes-page"
    @pointerdown="activity"
    @keydown="activity"
    @wheel.passive="activity"
    @touchmove.passive="activity"
  >
    <header class="notes-page-heading">
      <h1>Notes <span>Private</span></h1>
      <div v-if="state.phase === 'unlocked'" class="notes-page-actions">
        <span class="notes-save-status" role="status">{{ state.status }}</span>
        <button type="button" :disabled="formBusy" @click="lock">Lock now</button>
        <button
          type="button"
          :aria-expanded="settingsOpen"
          aria-controls="notes-settings"
          @click="settingsOpen = !settingsOpen"
        >
          Settings
        </button>
      </div>
    </header>
    <div v-if="state.error" class="notes-message error" role="alert">
      {{ state.error }}
      <button v-if="state.phase === 'unlocked'" @click="session.flush()">Retry save</button>
    </div>
    <div v-if="state.phase === 'loading'" class="notes-empty" role="status">
      Loading encrypted notes…
    </div>
    <div v-else-if="state.phase === 'error'" class="notes-empty">
      <button @click="session.initialize">Try again</button>
    </div>
    <div v-else-if="shielded" class="notes-unlock-area">
      <form class="notes-unlock-card" @submit.prevent="resumeHidden">
        <h2>Your notes are hidden</h2>
        <p>
          The newest changes could not be retained, so this session has not discarded them. Enter
          your password to retry saving or export an encrypted backup.
        </p>
        <label
          >Notes password<input
            v-model="password"
            type="password"
            autocomplete="current-password"
            required /></label
        ><button class="notes-primary" :disabled="formBusy">Resume unsaved notes</button>
      </form>
    </div>
    <template v-else-if="state.phase === 'locked' || settingUp">
      <div class="notes-unlock-area">
        <form v-if="recoveryKey" class="notes-unlock-card" @submit.prevent="finishSetup">
          <h2>Save your recovery key</h2>
          <p>
            Store this key outside Startree. It can unlock your notes if you forget the password.
          </p>
          <code class="notes-recovery-key">{{ recoveryKey }}</code>
          <p>Paste your saved key below to verify it before continuing.</p>
          <label
            >Verify recovery key<input
              v-model="recoveryCheck"
              autocomplete="off"
              spellcheck="false"
              required
          /></label>
          <button class="notes-primary" :disabled="formBusy">
            {{ formBusy ? 'Verifying…' : 'Verify and open notes' }}
          </button>
          <p class="notes-help">
            Without your password or recovery key, your notes cannot be recovered.
          </p>
          <button
            type="button"
            @click="
              session.cancelSetup();
              clearSecrets();
            "
          >
            Cancel
          </button>
        </form>
        <form v-else-if="settingUp" class="notes-unlock-card" @submit.prevent="beginSetup">
          <h2>
            {{ state.phase === 'setup' ? 'A private place to write' : 'Change notes password' }}
          </h2>
          <p>
            Your notes password is separate from your login. A new recovery key will also be
            created.
          </p>
          <label
            >New notes password<input
              v-model="password"
              type="password"
              minlength="12"
              maxlength="1024"
              autocomplete="new-password"
              required
          /></label>
          <label
            >Confirm password<input
              v-model="confirmation"
              type="password"
              minlength="12"
              maxlength="1024"
              autocomplete="new-password"
              required
          /></label>
          <button class="notes-primary" :disabled="formBusy">
            {{ formBusy ? 'Preparing…' : 'Continue to recovery key' }}
          </button>
          <p class="notes-help">
            Use at least 12 characters. Titles and content are encrypted in your browser before
            syncing.
          </p>
          <button
            v-if="setupOpen"
            type="button"
            :disabled="formBusy"
            @click="
              session.cancelSetup();
              clearSecrets();
            "
          >
            Cancel
          </button>
        </form>
        <form v-else class="notes-unlock-card" @submit.prevent="enter">
          <svg
            class="notes-lock-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            aria-hidden="true"
          >
            <rect x="5" y="10" width="14" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
          </svg>
          <h2>Your notes are locked</h2>
          <p>Unlock once to read, write, and search.</p>
          <label v-if="state.drafts.length"
            >Open copy<select v-model="selectedDraft">
              <option v-if="state.remote" value="">Cloud copy</option>
              <option v-for="draft in state.drafts" :key="draft.id" :value="draft.id">
                Local draft · {{ new Date(draft.savedAt).toLocaleString() }}
              </option>
            </select></label
          >
          <p v-if="state.drafts.length" class="notes-help">
            An encrypted local draft has not finished syncing. Select it to resume or review it.
            Older drafts may need the password used when they were saved.
          </p>
          <label
            >{{ recoveryMode ? 'Recovery key' : 'Notes password'
            }}<input
              v-model="password"
              type="password"
              :autocomplete="recoveryMode ? 'off' : 'current-password'"
              maxlength="1024"
              required
          /></label>
          <button class="notes-primary" :disabled="formBusy">
            {{ formBusy ? 'Unlocking…' : 'Unlock notes' }}
          </button>
          <button
            type="button"
            class="notes-text-button"
            @click="
              recoveryMode = !recoveryMode;
              password = '';
            "
          >
            {{ recoveryMode ? 'Use password' : 'Use recovery key' }}
          </button>
          <button v-if="selectedDraft" type="button" class="notes-text-button" @click="dropDraft">
            Discard selected draft
          </button>
          <p class="notes-help">Refreshing locks your notes. Bookmarks remain available.</p>
        </form>
      </div>
      <button
        type="button"
        class="notes-import"
        :disabled="formBusy || Boolean(recoveryKey)"
        @click="fileInput?.click()"
      >
        Import encrypted backup
      </button>
    </template>
    <template v-else>
      <div v-if="state.conflict" class="notes-message" role="alert">
        <span>The cloud copy changed. Your encrypted draft is safe on this device.</span
        ><button :disabled="state.busy" @click="session.merge">Keep both versions</button
        ><button @click="useCloud">Unlock cloud copy</button
        ><button @click="exportEncrypted">Export encrypted draft</button>
      </div>
      <div v-if="settingsOpen" id="notes-settings" class="notes-settings">
        <span>Auto-lock: 15 minutes of inactivity</span
        ><button
          @click="
            setupOpen = true;
            settingsOpen = false;
          "
        >
          Change password & recovery key</button
        ><button @click="exportEncrypted">Export encrypted backup</button>
      </div>
      <div class="notes-layout" :class="{ 'notes-mobile-editor': mobileEditor }">
        <aside class="notes-list" aria-label="Notes">
          <div class="notes-list-toolbar">
            <input
              v-model="query"
              type="search"
              placeholder="Search notes"
              aria-label="Search notes"
              autocomplete="off"
            /><button class="notes-primary" @click="add">＋ New</button>
          </div>
          <div class="notes-list-caption">{{ filtered.length }} notes <span>Last edited</span></div>
          <div class="notes-list-items">
            <button
              v-for="note in filtered"
              :key="note.id"
              class="notes-list-item"
              :class="{ selected: current?.id === note.id }"
              :aria-pressed="current?.id === note.id"
              @click="
                selectedId = note.id;
                mobileEditor = true;
              "
            >
              <strong>{{ note.title || 'Untitled note' }}</strong>
              <p>{{ note.body || 'Start writing…' }}</p>
              <time>{{ new Date(note.updatedAt).toLocaleDateString() }}</time>
            </button>
          </div>
          <p v-if="!filtered.length" class="notes-list-empty">
            {{ query ? 'No matching notes.' : 'Your notebook is ready.' }}
          </p>
        </aside>
        <section class="notes-editor" aria-label="Note editor">
          <template v-if="current">
            <div class="notes-editor-toolbar">
              <button class="notes-back" @click="mobileEditor = false">← Notes</button
              ><span>Plain text</span
              ><button class="notes-delete" @click="remove">Delete note</button>
            </div>
            <input
              v-model="current.title"
              class="notes-title-input"
              maxlength="300"
              aria-label="Note title"
              placeholder="Untitled note"
              autocomplete="off"
              spellcheck="false"
              @input="changed"
            />
            <textarea
              v-model="current.body"
              class="notes-body-input"
              maxlength="100000"
              aria-label="Note content"
              placeholder="Start writing…"
              spellcheck="false"
              @input="changed"
            ></textarea>
            <div class="notes-editor-footer">
              {{ current.body.length.toLocaleString() }} characters
            </div>
          </template>
          <div v-else class="notes-empty">
            <h2>Write something down</h2>
            <p>A thought, a list, something to come back to.</p>
            <button class="notes-primary" @click="add">New note</button>
          </div>
        </section>
      </div>
    </template>
    <input
      ref="fileInput"
      class="visually-hidden"
      type="file"
      accept="application/json,.json"
      aria-label="Import encrypted notes backup"
      @change="importEncrypted"
    />
  </section>
</template>

<style src="./notes.css"></style>
