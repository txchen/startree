import * as v from 'valibot';
import {
  vaultRecordSchema,
  vaultWriteSchema,
  type VaultRecord,
  type VaultWrite,
} from '../../shared/notes/contracts';
import { indexedDbRequest } from '../app/indexed-db';

export type NotesDraft = { id: string; savedAt: string; write: VaultWrite };
export const createNotesStorage = (factory: IDBFactory = indexedDB) => {
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('startree-notes', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('encrypted', { keyPath: 'id' });
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(new Error('Encrypted browser storage is unavailable.'));
  });
  const complete = (transaction: IDBTransaction) =>
    new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () =>
        reject(new Error('Encrypted draft could not be retained.'));
    });
  const write = async (value: object) => {
    const transaction = (await database).transaction('encrypted', 'readwrite');
    const done = complete(transaction);
    transaction.objectStore('encrypted').put(value);
    await done;
  };
  return {
    async read(): Promise<{ remote: VaultRecord | null; drafts: NotesDraft[] }> {
      const transaction = (await database).transaction('encrypted');
      const entries = (await indexedDbRequest(
        transaction.objectStore('encrypted').getAll(),
      )) as Array<Record<string, unknown>>;
      let remote: VaultRecord | null = null;
      const drafts: NotesDraft[] = [];
      for (const entry of entries) {
        if (entry.id === 'remote') {
          const result = v.safeParse(vaultRecordSchema, entry.record);
          if (result.success) remote = result.output;
        } else if (typeof entry.id === 'string' && typeof entry.savedAt === 'string') {
          const result = v.safeParse(vaultWriteSchema, entry.write);
          if (result.success)
            drafts.push({ id: entry.id, savedAt: entry.savedAt, write: result.output });
        }
      }
      return { remote, drafts: drafts.sort((a, b) => b.savedAt.localeCompare(a.savedAt)) };
    },
    saveRemote: (record: VaultRecord) =>
      write({ id: 'remote', record: v.parse(vaultRecordSchema, record) }),
    saveDraft: (draft: NotesDraft) =>
      write({ ...draft, write: v.parse(vaultWriteSchema, draft.write) }),
    async removeDraft(id: string) {
      const transaction = (await database).transaction('encrypted', 'readwrite');
      const done = complete(transaction);
      transaction.objectStore('encrypted').delete(id);
      await done;
    },
    async close() {
      (await database).close();
    },
  };
};
export const fetchNotes = async (): Promise<VaultRecord | null> => {
  const response = await fetch('/api/notes/vault', {
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok || response.redirected)
    throw new Error('Notes could not be synchronized. Check your connection or sign in again.');
  const data = (await response.json()) as { vault: unknown };
  return data.vault === null ? null : v.parse(vaultRecordSchema, data.vault);
};
export const writeNotes = async (write: VaultWrite): Promise<VaultRecord> => {
  const response = await fetch('/api/notes/vault', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(write),
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 409) throw new NotesConflict();
  if (!response.ok || response.redirected)
    throw new Error('Cloud save failed. Your encrypted draft is retained on this device.');
  const data = (await response.json()) as { vault: unknown };
  return v.parse(vaultRecordSchema, data.vault);
};
export class NotesConflict extends Error {}
