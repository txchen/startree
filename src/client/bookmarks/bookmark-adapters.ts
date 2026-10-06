import * as v from 'valibot';

import {
  BOOKMARK_SNAPSHOT_WIRE_FORMAT_VERSION,
  bookmarkCommandResultSchema,
  bookmarkCommandSchema,
  bookmarkSnapshotEtag,
  bookmarkSnapshotSchema,
  bookmarkTrashEtag,
  bookmarkTrashSchema,
  type BookmarkCommand,
  type BookmarkSnapshot,
  type BookmarkTrash,
} from '../../shared/bookmarks/contracts';
import {
  normalizeRecentBookmarks,
  RECENT_BOOKMARKS_SETTING,
  type RecentBookmarkStorage,
} from './recent-bookmarks';
import { indexedDbRequest } from '../app/indexed-db';
import { BOOKMARK_DATABASE_NAME } from '../app/local-data';
import type {
  BookmarkNavigation,
  BookmarkRevisionChannel,
  BookmarkRemoteAdapter,
  BookmarkStorageAdapter,
  StoredBookmarkSnapshot,
} from './bookmark-state';

export const createBroadcastBookmarkRevisionChannel = (
  channel: BroadcastChannel = new BroadcastChannel('startree-bookmark-revisions'),
): BookmarkRevisionChannel => ({
  announce(revision) {
    channel.postMessage({ revision });
  },
  subscribe(listener) {
    const receive = (event: MessageEvent<unknown>) => {
      const revision =
        typeof event.data === 'object' && event.data !== null && 'revision' in event.data
          ? (event.data as { revision?: unknown }).revision
          : undefined;
      if (typeof revision === 'number' && Number.isInteger(revision) && revision >= 0) {
        listener(revision);
      }
    };
    channel.addEventListener('message', receive);
    return () => channel.removeEventListener('message', receive);
  },
  close: () => channel.close(),
});

const transactionComplete = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('Snapshot replacement was interrupted.')),
      { once: true },
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')),
      { once: true },
    );
  });

export class UnknownBookmarkCommandError extends Error {
  override readonly name = 'UnknownBookmarkCommandError';
}

export const createFetchBookmarkAdapter = (
  fetcher: typeof fetch = fetch,
): BookmarkRemoteAdapter & {
  readTrash(revision: number | null, signal?: AbortSignal): Promise<BookmarkTrash | null>;
  executeCommand(
    command: BookmarkCommand,
    signal?: AbortSignal,
  ): Promise<import('../../shared/bookmarks/contracts').BookmarkCommandResult>;
} => ({
  async readSnapshot(revision, signal) {
    const headers =
      revision === null ? undefined : { 'If-None-Match': bookmarkSnapshotEtag(revision) };
    const response = await fetcher('/api/bookmarks/snapshot', {
      ...(headers ? { headers } : {}),
      signal,
    });
    if (response.status === 304) return null;
    if (!response.ok) throw new Error(`Bookmark snapshot request failed with ${response.status}.`);
    return v.parse(bookmarkSnapshotSchema, await response.json());
  },
  async readTrash(revision, signal) {
    const headers =
      revision === null ? undefined : { 'If-None-Match': bookmarkTrashEtag(revision) };
    const response = await fetcher('/api/bookmarks/trash', {
      ...(headers ? { headers } : {}),
      signal,
    });
    if (response.status === 304) return null;
    if (!response.ok) throw new Error(`Bookmark Trash request failed with ${response.status}.`);
    return v.parse(bookmarkTrashSchema, await response.json());
  },
  async executeCommand(command, signal) {
    const validatedCommand = v.parse(bookmarkCommandSchema, command);
    let response: Response;
    try {
      response = await fetcher('/api/bookmarks/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validatedCommand),
        signal,
      });
    } catch (error) {
      throw new UnknownBookmarkCommandError('The Bookmark command result is unknown.', {
        cause: error,
      });
    }
    if (response.status >= 500) {
      throw new UnknownBookmarkCommandError('The Bookmark command result is unknown.');
    }
    if (!response.ok && response.status !== 409) {
      throw new Error(`Bookmark command request failed with ${response.status}.`);
    }
    try {
      return v.parse(bookmarkCommandResultSchema, await response.json());
    } catch (error) {
      throw new UnknownBookmarkCommandError('The Bookmark command result is unknown.', {
        cause: error,
      });
    }
  },
});

const navigationSchema = v.object({
  selectedFolderId: v.pipe(v.string(), v.uuid()),
  expandedFolderIds: v.array(v.pipe(v.string(), v.uuid())),
});

type Setting = { key: string; value: unknown };
type CompleteSnapshotRecord = {
  key: string;
  wireFormatVersion: number;
  revision: number;
  snapshot: unknown;
  synchronizedAt?: string;
};

type UnconfirmedOperationRecord = {
  operationId: string;
  command: unknown;
  recordedAt: string;
};

const BOOKMARK_DATABASE_VERSION = 3;
// Refreshes that confirm the retained revision update this small record instead of rewriting the snapshot.
const SNAPSHOT_SYNCHRONIZATION_SETTING = 'activeSnapshotSynchronization';
const snapshotSynchronizationSchema = v.object({
  snapshotKey: v.string(),
  synchronizedAt: v.string(),
});
const snapshotKey = (snapshot: BookmarkSnapshot): string =>
  `${snapshot.wireFormatVersion}:${snapshot.revision}`;

export const createIndexedDbBookmarkAdapter = (
  indexedDb: IDBFactory = indexedDB,
  databaseName = BOOKMARK_DATABASE_NAME,
  hooks: { beforeSnapshotCommit?(transaction: IDBTransaction): void } = {},
): BookmarkStorageAdapter &
  RecentBookmarkStorage &
  Required<
    Pick<
      BookmarkStorageAdapter,
      'readUnconfirmedOperations' | 'writeUnconfirmedOperation' | 'removeUnconfirmedOperation'
    >
  > => {
  const databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDb.open(databaseName, BOOKMARK_DATABASE_VERSION);
    request.addEventListener(
      'upgradeneeded',
      (event) => {
        if (!request.result.objectStoreNames.contains('settings')) {
          request.result.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!request.result.objectStoreNames.contains('completeSnapshots')) {
          request.result.createObjectStore('completeSnapshots', { keyPath: 'key' });
        }
        if (!request.result.objectStoreNames.contains('unconfirmedOperations')) {
          request.result.createObjectStore('unconfirmedOperations', { keyPath: 'operationId' });
        }

        if (
          event.oldVersion === 1 &&
          request.result.objectStoreNames.contains('snapshots') &&
          request.transaction
        ) {
          const settings = request.transaction.objectStore('settings');
          const completeSnapshots = request.transaction.objectStore('completeSnapshots');
          const revisionRequest = settings.get('activeSnapshotRevision');
          revisionRequest.addEventListener('success', () => {
            const revision = (revisionRequest.result as Setting | undefined)?.value;
            if (typeof revision !== 'number') return;
            const snapshotRequest = request.transaction?.objectStore('snapshots').get(revision);
            snapshotRequest?.addEventListener('success', () => {
              const result = v.safeParse(bookmarkSnapshotSchema, snapshotRequest.result);
              if (!result.success) return;
              const key = snapshotKey(result.output);
              completeSnapshots.put({
                key,
                wireFormatVersion: result.output.wireFormatVersion,
                revision: result.output.revision,
                snapshot: result.output,
                synchronizedAt: undefined,
              } satisfies CompleteSnapshotRecord);
              settings.put({ key: 'activeSnapshotKey', value: key } satisfies Setting);
            });
          });
        }
      },
      { once: true },
    );
    request.addEventListener(
      'success',
      () => {
        request.result.addEventListener('versionchange', () => request.result.close());
        resolve(request.result);
      },
      { once: true },
    );
    request.addEventListener('error', () => reject(request.error), { once: true });
  });

  const readSetting = async (key: string): Promise<unknown> => {
    const database = await databasePromise;
    const transaction = database.transaction('settings', 'readonly');
    const setting = await indexedDbRequest<Setting | undefined>(
      transaction.objectStore('settings').get(key),
    );
    await transactionComplete(transaction);
    return setting?.value;
  };

  return {
    async readRecentBookmarks() {
      return normalizeRecentBookmarks(await readSetting(RECENT_BOOKMARKS_SETTING));
    },
    async updateRecentBookmarks(id) {
      const database = await databasePromise;
      const transaction = database.transaction('settings', 'readwrite');
      const complete = transactionComplete(transaction);
      const settings = transaction.objectStore('settings');
      const request = settings.get(RECENT_BOOKMARKS_SETTING);
      let ids: string[] = [];
      request.addEventListener(
        'success',
        () => {
          ids =
            id === null
              ? []
              : normalizeRecentBookmarks([id, ...normalizeRecentBookmarks(request.result?.value)]);
          settings.put({ key: RECENT_BOOKMARKS_SETTING, value: ids });
        },
        { once: true },
      );
      await complete;
      return ids;
    },
    async readSnapshot() {
      const database = await databasePromise;
      const transaction = database.transaction(['settings', 'completeSnapshots'], 'readonly');
      const settings = transaction.objectStore('settings');
      const key = (await indexedDbRequest<Setting | undefined>(settings.get('activeSnapshotKey')))
        ?.value;
      if (typeof key !== 'string') return { status: 'empty' };
      const [record, synchronization] = await Promise.all([
        indexedDbRequest<CompleteSnapshotRecord | undefined>(
          transaction.objectStore('completeSnapshots').get(key),
        ),
        indexedDbRequest<Setting | undefined>(settings.get(SNAPSHOT_SYNCHRONIZATION_SETTING)),
      ]);
      await transactionComplete(transaction);
      if (!record) return { status: 'empty' };
      if (record.wireFormatVersion !== BOOKMARK_SNAPSHOT_WIRE_FORMAT_VERSION) {
        return {
          status: 'incompatible',
          wireFormatVersion:
            typeof record.wireFormatVersion === 'number' ? record.wireFormatVersion : null,
        } satisfies StoredBookmarkSnapshot;
      }
      const result = v.safeParse(bookmarkSnapshotSchema, record.snapshot);
      const synchronized = v.safeParse(snapshotSynchronizationSchema, synchronization?.value);
      return result.success
        ? ({
            status: 'compatible',
            snapshot: result.output,
            synchronizedAt:
              synchronized.success && synchronized.output.snapshotKey === key
                ? synchronized.output.synchronizedAt
                : (record.synchronizedAt ?? null),
          } satisfies StoredBookmarkSnapshot)
        : ({
            status: 'incompatible',
            wireFormatVersion: record.wireFormatVersion,
          } satisfies StoredBookmarkSnapshot);
    },
    // Callers pass already validated snapshots; re-parsing would copy the whole library.
    async writeSnapshot(snapshot: BookmarkSnapshot, metadata: { synchronizedAt: string }) {
      const database = await databasePromise;
      const transaction = database.transaction(['completeSnapshots', 'settings'], 'readwrite');
      const key = snapshotKey(snapshot);
      transaction.objectStore('completeSnapshots').put({
        key,
        wireFormatVersion: snapshot.wireFormatVersion,
        revision: snapshot.revision,
        snapshot,
        synchronizedAt: metadata.synchronizedAt,
      } satisfies CompleteSnapshotRecord);
      const settings = transaction.objectStore('settings');
      settings.put({ key: 'activeSnapshotKey', value: key } satisfies Setting);
      settings.put({
        key: SNAPSHOT_SYNCHRONIZATION_SETTING,
        value: { snapshotKey: key, synchronizedAt: metadata.synchronizedAt },
      } satisfies Setting);
      hooks.beforeSnapshotCommit?.(transaction);
      await transactionComplete(transaction);
    },
    async writeSnapshotSynchronization(snapshot: BookmarkSnapshot, synchronizedAt: string) {
      const database = await databasePromise;
      const transaction = database.transaction('settings', 'readwrite');
      transaction.objectStore('settings').put({
        key: SNAPSHOT_SYNCHRONIZATION_SETTING,
        value: { snapshotKey: snapshotKey(snapshot), synchronizedAt },
      } satisfies Setting);
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
    async clear() {
      const database = await databasePromise;
      database.close();
      await indexedDbRequest(indexedDb.deleteDatabase(databaseName));
    },
    async readUnconfirmedOperations() {
      const database = await databasePromise;
      const transaction = database.transaction('unconfirmedOperations', 'readonly');
      const records = await indexedDbRequest<UnconfirmedOperationRecord[]>(
        transaction.objectStore('unconfirmedOperations').getAll(),
      );
      await transactionComplete(transaction);
      return records
        .map((record) => {
          const command = v.safeParse(bookmarkCommandSchema, record.command);
          return command.success
            ? { command: command.output, recordedAt: record.recordedAt }
            : null;
        })
        .filter((record): record is NonNullable<typeof record> => record !== null)
        .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
    },
    async writeUnconfirmedOperation(command, recordedAt) {
      const validated = v.parse(bookmarkCommandSchema, command);
      const database = await databasePromise;
      const transaction = database.transaction('unconfirmedOperations', 'readwrite');
      transaction.objectStore('unconfirmedOperations').put({
        operationId: validated.operationId,
        command: validated,
        recordedAt,
      } satisfies UnconfirmedOperationRecord);
      await transactionComplete(transaction);
    },
    async removeUnconfirmedOperation(operationId) {
      const database = await databasePromise;
      const transaction = database.transaction('unconfirmedOperations', 'readwrite');
      transaction.objectStore('unconfirmedOperations').delete(operationId);
      await transactionComplete(transaction);
    },
  };
};
