import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import type { VaultRecord, VaultWrite } from '../../shared/notes/contracts';
import { createNotesStorage, NotesConflict } from './notes-storage';
import { createNotesSession } from './notes-session';
import { unlockVault } from './notes-crypto';
const password = 'a long test password';
const createFixture = () => {
  const storage = createNotesStorage(new IDBFactory());
  let cloud: VaultRecord | null = null;
  let offline = false;
  const dependencies = {
    storage,
    read: async () => {
      if (offline) throw new Error('offline');
      return cloud;
    },
    write: async (write: VaultWrite) => {
      if (offline) throw new Error('offline');
      if (cloud?.operationId === write.operationId) return cloud;
      if (write.expectedRevision !== (cloud?.revision ?? 0)) throw new NotesConflict();
      cloud = {
        revision: (cloud?.revision ?? 0) + 1,
        operationId: write.operationId,
        vault: write.vault,
        updatedAt: new Date().toISOString(),
      };
      return cloud;
    },
  };
  return {
    dependencies,
    session: createNotesSession(dependencies),
    setOffline: (value: boolean) => (offline = value),
    cloud: () => cloud!,
  };
};
const setup = async (fixture: ReturnType<typeof createFixture>) => {
  await fixture.session.initialize();
  const recovery = await fixture.session.beginSetup(password);
  expect(recovery).toBeTruthy();
  expect(await fixture.session.confirmSetup(recovery!)).toBe(true);
};
const edit = (session: ReturnType<typeof createNotesSession>, title: string) => {
  session.state.notes.push({
    id: crypto.randomUUID(),
    title,
    body: 'Private note body',
    updatedAt: new Date().toISOString(),
  });
  session.changed();
};

describe('notes session safety', () => {
  it('verifies recovery before setup and clears plaintext on lock', async () => {
    const f = createFixture();
    await f.session.initialize();
    await f.session.beginSetup(password);
    expect(await f.session.confirmSetup('incorrect')).toBe(false);
    expect(f.cloud()).toBeNull();
    await setup(f);
    edit(f.session, 'Secret title');
    await f.session.flush();
    expect(JSON.stringify(await f.dependencies.storage.read())).not.toContain('Secret title');
    expect(await f.session.lock()).toBe(true);
    expect(f.session.state.notes).toEqual([]);
    expect(f.session.state.phase).toBe('locked');
    expect(await f.session.unlock('wrong', false)).toBe(false);
    expect(await f.session.unlock(password, false)).toBe(true);
    expect(f.session.state.notes[0]?.title).toBe('Secret title');
    await f.session.dispose();
  });
  it('retains offline encrypted drafts through locking and resumes without data loss', async () => {
    const f = createFixture();
    await setup(f);
    f.setOffline(true);
    edit(f.session, 'Offline draft');
    await Promise.all([f.session.flush(), f.session.flush()]);
    expect(f.session.state.localSafe).toBe(true);
    expect(await f.session.lock()).toBe(true);
    const draftId = f.session.state.drafts[0]!.id;
    expect(await f.session.unlock(password, false, draftId)).toBe(true);
    expect(f.session.state.notes[0]?.title).toBe('Offline draft');
    f.setOffline(false);
    await f.session.flush();
    expect((await f.dependencies.storage.read()).drafts).toHaveLength(0);
    expect((await unlockVault(f.cloud().vault, password)).notes[0]?.title).toBe('Offline draft');
    await f.session.dispose();
  });
  it('keeps both concurrent edits only after an explicit merge', async () => {
    const f = createFixture();
    await setup(f);
    const other = createNotesSession({
      ...f.dependencies,
      storage: createNotesStorage(new IDBFactory()),
    });
    await other.initialize();
    await other.unlock(password, false);
    edit(f.session, 'First device');
    await f.session.flush();
    edit(other, 'Second device');
    await other.flush();
    expect(other.state.conflict).toBe(true);
    expect(other.state.notes[0]?.title).toBe('Second device');
    await other.merge();
    expect(other.state.conflict).toBe(false);
    expect(other.state.notes.map((note) => note.title)).toEqual([
      'Second device (local copy)',
      'First device',
    ]);
    await other.dispose();
    await f.session.dispose();
  });
  it('does not lock and discard edits when encrypted local retention fails', async () => {
    const f = createFixture();
    await setup(f);
    f.dependencies.storage.saveDraft = async () => {
      throw new Error('storage full');
    };
    edit(f.session, 'Unsaved');
    expect(await f.session.lock()).toBe(false);
    expect(f.session.state.phase).toBe('unlocked');
    expect(f.session.state.notes[0]?.title).toBe('Unsaved');
    const backup = await f.session.encryptedExport();
    expect((await unlockVault(backup!.vault, password)).notes[0]?.title).toBe('Unsaved');
    await f.session.dispose();
  });
  it('does not resurrect an unlocked session after a late password derivation', async () => {
    const f = createFixture();
    await setup(f);
    await f.session.lock();
    const unlock = f.session.unlock(password, false);
    f.session.forget();
    expect(await unlock).toBe(false);
    expect(f.session.state.notes).toEqual([]);
    await f.session.dispose();
  });
});

it('does not repopulate plaintext when a conflict read completes after locking', async () => {
  const f = createFixture();
  await setup(f);
  edit(f.session, 'Cloud note');
  await f.session.flush();
  f.session.state.conflict = true;
  edit(f.session, 'Local note');
  await f.session.flush();
  let release!: (record: VaultRecord) => void;
  let started!: () => void;
  const reading = new Promise<void>((resolve) => (started = resolve));
  f.dependencies.read = () => {
    started();
    return new Promise<VaultRecord>((resolve) => (release = resolve));
  };
  const merging = f.session.merge();
  await reading;
  expect(await f.session.lock()).toBe(true);
  release(f.cloud());
  await merging;
  expect(f.session.state.phase).toBe('locked');
  expect(f.session.state.notes).toEqual([]);
  await f.session.dispose();
});

it('debounces typing for two seconds and bounds continuous typing at fifteen seconds', async () => {
  const f = createFixture();
  await setup(f);
  const write = vi.fn(f.dependencies.write);
  f.dependencies.write = write;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  try {
    edit(f.session, 'Typing');
    for (let second = 0; second < 14; second++) {
      await vi.advanceTimersByTimeAsync(1_000);
      f.session.state.notes[0]!.body += '.';
      f.session.changed();
      await f.session.refresh();
      expect(write).not.toHaveBeenCalled();
    }
    await vi.advanceTimersByTimeAsync(999);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    await f.session.flush();
    f.session.state.notes[0]!.body += ' paused';
    f.session.changed();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    await f.session.flush();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(write).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
    await f.session.dispose();
  }
});
