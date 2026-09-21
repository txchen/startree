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

it('never autosaves and creates one history entry per changed manual save', async () => {
  const f = createFixture();
  await setup(f);
  const write = vi.fn(f.dependencies.write);
  f.dependencies.write = write;
  edit(f.session, 'First title');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  try {
    await vi.advanceTimersByTimeAsync(120_000);
    await f.session.refresh();
    expect(write).not.toHaveBeenCalled();
    expect(await f.session.lock()).toBe(false);
  } finally {
    vi.useRealTimers();
  }
  await f.session.flush();
  const note = f.session.state.notes[0]!;
  expect(note.history).toHaveLength(1);
  expect(f.session.state.unsaved).toBe(false);
  await f.session.flush();
  expect(write).toHaveBeenCalledTimes(1);
  note.body = 'Second version';
  f.session.changed();
  await f.session.flush();
  expect(note.history).toHaveLength(2);
  note.body = 'temporary edit';
  f.session.changed();
  note.body = 'Second version';
  f.session.changed();
  expect(f.session.state.unsaved).toBe(false);
  await f.session.flush();
  expect(write).toHaveBeenCalledTimes(2);
  await f.session.restore(note.id, 1);
  expect(note.body).toBe('Private note body');
  expect(note.history).toHaveLength(3);
  expect(note.history?.map((item) => item.revision)).toEqual([1, 2, 3]);
  await f.session.lock();
  await f.session.unlock(password, false);
  expect(f.session.state.notes[0]?.history).toHaveLength(3);
  const recovery = await f.session.beginSetup('a replacement password');
  await f.session.confirmSetup(recovery!);
  const opened = await unlockVault(f.cloud().vault, 'a replacement password');
  expect(opened.notes[0]?.history).toHaveLength(3);
  expect(JSON.stringify(f.cloud())).not.toContain('Second version');
  await f.session.dispose();
});

it('retains several offline manual versions and discards only uncommitted edits', async () => {
  const f = createFixture();
  await setup(f);
  f.setOffline(true);
  edit(f.session, 'Offline history');
  await f.session.flush();
  f.session.state.notes[0]!.body = 'Offline second version';
  f.session.changed();
  await f.session.flush();
  f.session.state.notes[0]!.body = 'Discard me';
  f.session.changed();
  await f.session.discardChanges();
  expect(f.session.state.notes[0]?.body).toBe('Offline second version');
  expect(f.session.state.notes[0]?.history).toHaveLength(2);
  f.setOffline(false);
  await f.session.refresh();
  const opened = await unlockVault(f.cloud().vault, password);
  expect(opened.notes[0]?.history).toHaveLength(2);
  await f.session.dispose();
});

it('keeps edits made during a manual save pending until the next explicit save', async () => {
  const f = createFixture();
  await setup(f);
  edit(f.session, 'During save');
  await f.session.flush();
  const note = f.session.state.notes[0]!;
  note.body = 'Captured version';
  f.session.changed();
  const saveDraft = f.dependencies.storage.saveDraft.bind(f.dependencies.storage);
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.dependencies.storage.saveDraft = async (draft) => {
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await saveDraft(draft);
  };
  const saving = f.session.flush();
  await waiting;
  note.body = 'Private note body';
  f.session.changed();
  release();
  await saving;
  expect(f.session.state.unsaved).toBe(true);
  expect(note.history).toHaveLength(2);
  expect((await unlockVault(f.cloud().vault, password)).notes[0]?.body).toBe('Captured version');
  f.dependencies.storage.saveDraft = saveDraft;
  await f.session.flush();
  expect(note.history).toHaveLength(3);
  expect(f.session.state.unsaved).toBe(false);
  await f.session.dispose();
});

it('rejects oversized history without pruning versions or replacing the cloud copy', async () => {
  const f = createFixture();
  await setup(f);
  edit(f.session, 'Large history');
  for (let version = 1; version <= 4; version++) {
    f.session.state.notes[0]!.body = String(version).repeat(90_000);
    f.session.changed();
    await f.session.flush();
    expect(f.session.state.error).toBe('');
  }
  const revision = f.cloud().revision;
  f.session.state.notes[0]!.body = '5'.repeat(90_000);
  f.session.changed();
  await f.session.flush();
  expect(f.session.state.unsaved).toBe(true);
  expect(f.session.state.error).toContain('512 KB');
  expect(f.cloud().revision).toBe(revision);
  expect(f.session.state.notes[0]?.history).toHaveLength(4);
  await f.session.dispose();
});

it('exports unsaved edits without committing them or adding a history entry', async () => {
  const f = createFixture();
  await setup(f);
  edit(f.session, 'Export only');
  const revision = f.cloud().revision;
  const backup = await f.session.encryptedExport();
  expect((await unlockVault(backup!.vault, password)).notes[0]?.title).toBe('Export only');
  expect(f.cloud().revision).toBe(revision);
  expect(f.session.state.unsaved).toBe(true);
  await f.session.dispose();
});
