import * as v from 'valibot';

import {
  BOOKMARK_SNAPSHOT_WIRE_FORMAT_VERSION,
  bookmarkSnapshotEtag,
  bookmarkSnapshotSchema,
  type BookmarkSnapshot,
} from '../../shared/bookmarks/contracts';
import type {
  BookmarkNavigation,
  BookmarkRemoteAdapter,
  BookmarkStorageAdapter,
} from './bookmark-state';

const requestResult = <Result>(request: IDBRequest<Result>): Promise<Result> =>
  new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });

const transactionComplete = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error), { once: true });
  });

export const createFetchBookmarkAdapter = (
  fetcher: typeof fetch = fetch,
): BookmarkRemoteAdapter => ({
  async readSnapshot(revision) {
    const headers =
      revision === null ? undefined : { 'If-None-Match': bookmarkSnapshotEtag(revision) };
    const response = await fetcher('/api/bookmarks/snapshot', headers ? { headers } : undefined);
    if (response.status === 304) return null;
    if (!response.ok) throw new Error(`Bookmark snapshot request failed with ${response.status}.`);
    return v.parse(bookmarkSnapshotSchema, await response.json());
  },
});

const navigationSchema = v.object({
  selectedFolderId: v.pipe(v.string(), v.uuid()),
  expandedFolderIds: v.array(v.pipe(v.string(), v.uuid())),
});

type Setting = { key: string; value: unknown };

export const createIndexedDbBookmarkAdapter = (
  indexedDb: IDBFactory = indexedDB,
  databaseName = 'startree-bookmarks',
): BookmarkStorageAdapter => {
  const databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDb.open(databaseName, BOOKMARK_SNAPSHOT_WIRE_FORMAT_VERSION);
    request.addEventListener(
      'upgradeneeded',
      () => {
        if (!request.result.objectStoreNames.contains('snapshots')) {
          request.result.createObjectStore('snapshots', { keyPath: 'revision' });
        }
        if (!request.result.objectStoreNames.contains('settings')) {
          request.result.createObjectStore('settings', { keyPath: 'key' });
        }
      },
      { once: true },
    );
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });

  const readSetting = async (key: string): Promise<unknown> => {
    const database = await databasePromise;
    const transaction = database.transaction('settings', 'readonly');
    const setting = await requestResult<Setting | undefined>(
      transaction.objectStore('settings').get(key),
    );
    await transactionComplete(transaction);
    return setting?.value;
  };

  return {
    async readSnapshot() {
      const revision = await readSetting('activeSnapshotRevision');
      if (typeof revision !== 'number') return null;
      const database = await databasePromise;
      const transaction = database.transaction('snapshots', 'readonly');
      const snapshot = await requestResult<unknown>(
        transaction.objectStore('snapshots').get(revision),
      );
      await transactionComplete(transaction);
      const result = v.safeParse(bookmarkSnapshotSchema, snapshot);
      return result.success ? result.output : null;
    },
    async writeSnapshot(snapshot: BookmarkSnapshot) {
      const validated = v.parse(bookmarkSnapshotSchema, snapshot);
      const database = await databasePromise;
      const transaction = database.transaction(['snapshots', 'settings'], 'readwrite');
      transaction.objectStore('snapshots').put(validated);
      transaction
        .objectStore('settings')
        .put({ key: 'activeSnapshotRevision', value: validated.revision } satisfies Setting);
      await transactionComplete(transaction);
    },
    async readNavigation() {
      const result = v.safeParse(navigationSchema, await readSetting('navigation'));
      return result.success ? result.output : null;
    },
    async writeNavigation(navigation: BookmarkNavigation) {
      const validated = v.parse(navigationSchema, navigation);
      const database = await databasePromise;
      const transaction = database.transaction('settings', 'readwrite');
      transaction
        .objectStore('settings')
        .put({ key: 'navigation', value: validated } satisfies Setting);
      await transactionComplete(transaction);
    },
  };
};
