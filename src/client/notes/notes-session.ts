import * as v from 'valibot';
import { vaultWriteSchema } from '../../shared/notes/contracts';
import { reactive } from 'vue';
import type { EncryptedVault, VaultRecord, VaultWrite } from '../../shared/notes/contracts';
import { createVault, decryptNotes, encryptNotes, unlockVault, type Note } from './notes-crypto';
import {
  createNotesStorage,
  fetchNotes,
  NotesConflict,
  writeNotes,
  type NotesDraft,
} from './notes-storage';

type Dependencies = {
  storage: ReturnType<typeof createNotesStorage>;
  read: typeof fetchNotes;
  write: typeof writeNotes;
};
export const createNotesSession = (
  deps: Dependencies = { storage: createNotesStorage(), read: fetchNotes, write: writeNotes },
) => {
  const state = reactive({
    phase: 'loading' as 'loading' | 'locked' | 'setup' | 'unlocked' | 'error',
    notes: [] as Note[],
    drafts: [] as NotesDraft[],
    remote: null as VaultRecord | null,
    status: '' as string,
    error: '',
    conflict: false,
    busy: false,
    localSafe: true,
    connected: false,
  });
  let key: CryptoKey | null = null;
  let vault: EncryptedVault | null = null;
  let revision = 0;
  let draftId: string = crypto.randomUUID();
  let editVersion = 0;
  let savedVersion = 0;
  let durableVersion = 0;
  let dirtySince = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let maxTimer: ReturnType<typeof setTimeout> | undefined;
  let pending: VaultWrite | null = null;
  let job: Promise<void> | null = null;
  let epoch = 0;
  let disposed = false;
  let generation: Awaited<ReturnType<typeof createVault>> | null = null;
  let generationRevision = 0;
  const errorMessage = (error: unknown) =>
    error instanceof Error ? error.message : 'Notes could not be saved.';
  const loadDrafts = async () => {
    state.drafts = (await deps.storage.read()).drafts;
  };
  const initialize = async () => {
    state.phase = 'loading';
    state.error = '';
    try {
      const local = await deps.storage.read();
      state.remote = local.remote;
      state.drafts = local.drafts;
    } catch {
      state.error =
        'Browser storage is unavailable. Notes cannot be edited safely in this session.';
      state.phase = 'error';
      return;
    }
    try {
      state.remote = await deps.read();
      state.connected = true;
      if (state.remote) await deps.storage.saveRemote(state.remote);
    } catch {
      state.connected = false;
    }
    state.phase =
      state.remote || state.drafts.length ? 'locked' : state.connected ? 'setup' : 'error';
    if (state.phase === 'error') state.error = 'Connect once to load or set up encrypted notes.';
  };
  const unlock = async (secret: string, recovery: boolean, selectedDraft?: string) => {
    if (state.busy) return false;
    state.busy = true;
    state.error = '';
    const token = epoch;
    try {
      const draft =
        state.drafts.find((item) => item.id === selectedDraft) ??
        (!state.remote ? state.drafts[0] : undefined);
      const encrypted = draft?.write.vault ?? state.remote?.vault;
      if (!encrypted) throw new Error('No encrypted notes are available.');
      const opened = await unlockVault(encrypted, secret, recovery);
      if (token !== epoch) return false;
      key = opened.key;
      vault = encrypted;
      state.notes = opened.notes;
      revision = draft?.write.expectedRevision ?? state.remote!.revision;
      draftId = draft?.id ?? crypto.randomUUID();
      pending = draft?.write ?? null;
      editVersion = savedVersion = durableVersion = 0;
      state.localSafe = true;
      state.conflict = Boolean(
        draft &&
        state.remote &&
        state.remote.revision !== revision &&
        state.remote.operationId !== draft.write.operationId,
      );
      state.phase = 'unlocked';
      state.status = draft
        ? 'Encrypted draft on this device'
        : state.connected
          ? 'Saved'
          : 'Offline · retained copy';
      return true;
    } catch {
      state.error = recovery
        ? 'The recovery key could not unlock these notes.'
        : 'The password could not unlock these notes.';
      return false;
    } finally {
      state.busy = false;
    }
  };
  const scheduleSave = () => {
    if (timer === undefined)
      timer = setTimeout(() => {
        timer = undefined;
        void flush(false);
      }, 2_000);
    if (maxTimer === undefined)
      maxTimer = setTimeout(
        () => {
          maxTimer = undefined;
          void flush(false);
        },
        Math.max(0, 15_000 - (Date.now() - dirtySince)),
      );
  };
  const flush = async (drain = true): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    clearTimeout(maxTimer);
    maxTimer = undefined;
    if (job) {
      await job;
      if (editVersion > durableVersion && !state.error && key) {
        if (drain) await flush();
        else scheduleSave();
      }
      return;
    }
    if (!key || !vault || state.phase !== 'unlocked') return;
    const token = epoch;
    const activeKey = key;
    job = (async () => {
      try {
        if (editVersion > durableVersion) {
          const version = editVersion;
          const capturedAt = Date.now();
          const notes = state.notes.map((note) => ({ ...note }));
          const encrypted = await encryptNotes(activeKey, vault!, notes);
          if (token !== epoch) return;
          const write: VaultWrite = {
            expectedRevision: revision,
            operationId: crypto.randomUUID(),
            vault: encrypted,
          };
          await deps.storage.saveDraft({ id: draftId, savedAt: new Date().toISOString(), write });
          if (token !== epoch) return;
          vault = encrypted;
          pending = write;
          durableVersion = version;
          dirtySince = editVersion === version ? 0 : capturedAt;
          state.localSafe = durableVersion === editVersion;
        }
        if (!pending) return;
        state.status = state.conflict ? 'Conflict · encrypted draft retained' : 'Saving…';
        if (state.conflict) return;
        const sent = pending;
        const sentDraftId = draftId;
        try {
          const record = await deps.write(sent);
          if (token !== epoch) return;
          revision = record.revision;
          state.remote = record;
          state.connected = true;
          pending = null;
          savedVersion = durableVersion;
          await deps.storage.saveRemote(record);
          await deps.storage.removeDraft(sentDraftId);
          state.status = 'Saved';
          state.error = '';
        } catch (error) {
          if (token !== epoch) return;
          if (error instanceof NotesConflict) {
            state.conflict = true;
            state.status = 'Conflict · encrypted draft retained';
          } else {
            state.connected = false;
            state.status = 'Saved on this device · sync pending';
          }
        }
      } catch (error) {
        if (token === epoch) {
          state.error = errorMessage(error);
          state.status = 'Not saved';
          state.localSafe = false;
        }
      }
    })();
    await job;
    job = null;
    if (token === epoch && editVersion > durableVersion && !state.error) {
      if (drain) await flush();
      else scheduleSave();
    }
  };
  const changed = () => {
    if (editVersion === durableVersion) dirtySince = Date.now();
    editVersion++;
    state.localSafe = false;
    state.status = 'Waiting to save…';
    state.error = '';
    clearTimeout(timer);
    timer = undefined;
    scheduleSave();
  };
  const beginSetup = async (password: string) => {
    if (state.busy) return null;
    state.busy = true;
    state.error = '';
    const token = epoch;
    try {
      if (state.phase === 'unlocked') {
        await flush();
        if (!state.localSafe || pending || state.conflict)
          throw new Error('Sync or resolve your current draft before changing the password.');
      }
      generationRevision = revision;
      const prepared = await createVault(
        password,
        state.phase === 'unlocked' ? state.notes.map((note) => ({ ...note })) : [],
      );
      if (token !== epoch) return null;
      generation = prepared;
      return generation.recovery;
    } catch (error) {
      state.error = errorMessage(error);
      return null;
    } finally {
      state.busy = false;
    }
  };
  const confirmSetup = async (recovery: string): Promise<boolean> => {
    if (!generation) return false;
    const prepared = generation;
    const token = epoch;
    state.busy = true;
    state.error = '';
    try {
      // Verify the saved recovery key against the actual envelope before accepting setup.
      const verified = await unlockVault(prepared.vault, recovery, true);
      if (token !== epoch) return false;
      if (!state.localSafe) throw new Error('Save the current draft before changing the password.');
      key = verified.key;
      vault = prepared.vault;
      state.notes = verified.notes;
      revision = generationRevision;
      draftId = crypto.randomUUID();
      editVersion = 1;
      durableVersion = savedVersion = 0;
      pending = null;
      state.phase = 'unlocked';
      state.conflict = false;
      generation = null;
      await flush();
      return state.localSafe;
    } catch {
      state.error =
        'Recovery verification failed, or the current draft could not be saved. Check the key and try again.';
      return false;
    } finally {
      state.busy = false;
    }
  };
  const forget = () => {
    epoch++;
    clearTimeout(timer);
    timer = undefined;
    clearTimeout(maxTimer);
    maxTimer = undefined;
    key = null;
    vault = null;
    generation = null;
    state.notes = [];
    pending = null;
    state.conflict = false;
    state.phase = 'locked';
    state.busy = false;
    state.status = '';
    state.error = '';
  };
  const lock = async (): Promise<boolean> => {
    await flush();
    if (!state.localSafe) {
      state.error =
        'The latest changes are not retained. Retry saving or export your notes before locking.';
      return false;
    }
    forget();
    try {
      await loadDrafts();
    } catch {
      /* Retain the last known encrypted draft list. */
    }
    return true;
  };
  const merge = async () => {
    if (!key) return;
    const token = epoch;
    const activeKey = key;
    state.busy = true;
    state.error = '';
    try {
      await flush();
      if (!state.localSafe) return;
      const remote = await deps.read();
      if (!remote || remote.vault.id !== vault?.id)
        throw new Error(
          'The notes password changed on another device. Export this encrypted draft, lock, and unlock the cloud copy with the new password.',
        );
      const cloudNotes = await decryptNotes(activeKey, remote.vault);
      if (token !== epoch) return;
      // Preserve both sides, including local deletions, by making explicitly named local copies.
      const copies = state.notes
        .filter(
          (note) =>
            !cloudNotes.some(
              (other) =>
                other.id === note.id && other.title === note.title && other.body === note.body,
            ),
        )
        .map((note) => ({
          ...note,
          id: crypto.randomUUID(),
          title: `${note.title.slice(0, 280)} (local copy)`,
        }));
      state.notes = [...copies, ...cloudNotes];
      revision = remote.revision;
      state.remote = remote;
      vault = remote.vault;
      state.conflict = false;
      changed();
      await flush();
    } catch (error) {
      state.error = errorMessage(error);
    } finally {
      state.busy = false;
    }
  };
  const refresh = async () => {
    if (state.busy || job || disposed || generation) return;
    if (state.phase !== 'unlocked') return;
    if (editVersion > durableVersion) return;
    if (pending) {
      await flush(false);
      return;
    }
    const token = epoch;
    try {
      const remote = await deps.read();
      if (!remote || token !== epoch || !key || editVersion > savedVersion) return;
      if (remote.revision !== revision) {
        if (remote.vault.id !== vault?.id) {
          await lock();
          state.remote = remote;
          state.error = 'The notes password changed. Unlock again with the current password.';
        } else {
          const notes = await decryptNotes(key, remote.vault);
          if (token !== epoch || editVersion > savedVersion) return;
          state.notes = notes;
          state.remote = remote;
          revision = remote.revision;
          vault = remote.vault;
        }
        await deps.storage.saveRemote(remote);
      }
      state.connected = true;
    } catch {
      state.connected = false;
    }
  };
  return {
    state,
    initialize,
    unlock,
    changed,
    flush,
    beginSetup,
    confirmSetup,
    lock,
    forget,
    merge,
    refresh,
    async verifySessionPassword(secret: string) {
      if (!vault) return false;
      try {
        await unlockVault(vault, secret);
        return true;
      } catch {
        return false;
      }
    },
    cancelSetup() {
      generation = null;
    },
    async encryptedExport() {
      await flush();
      if (!state.localSafe && key && vault) {
        return {
          expectedRevision: revision,
          operationId: crypto.randomUUID(),
          vault: await encryptNotes(
            key,
            vault,
            state.notes.map((note) => ({ ...note })),
          ),
        };
      }
      return (
        pending ??
        (state.remote
          ? {
              expectedRevision: state.remote.revision,
              operationId: crypto.randomUUID(),
              vault: state.remote.vault,
            }
          : null)
      );
    },
    async importEncrypted(value: unknown) {
      const write = v.parse(vaultWriteSchema, value);
      await deps.storage.saveDraft({
        id: crypto.randomUUID(),
        savedAt: new Date().toISOString(),
        write,
      });
      await loadDrafts();
      state.phase = 'locked';
    },
    async removeDraft(id: string) {
      await deps.storage.removeDraft(id);
      await loadDrafts();
    },
    async dispose() {
      disposed = true;
      forget();
      try {
        await deps.storage.close();
      } catch {
        /* Failed storage initialization owns no open connection. */
      }
    },
  };
};
