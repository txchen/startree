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
const snapshotKey = (snapshot: BookmarkSnapshot): string =>
  `${snapshot.wireFormatVersion}:${snapshot.revision}`;

export const createIndexedDbBookmarkAdapter = (
  indexedDb: IDBFactory = indexedDB,
  databaseName = BOOKMARK_DATABASE_NAME,
  hooks: { beforeSnapshotCommit?(transaction: IDBTransaction): void } = {},
): BookmarkStorageAdapter &
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
    async readSnapshot() {
      const key = await readSetting('activeSnapshotKey');
      if (typeof key !== 'string') return { status: 'empty' };
      const database = await databasePromise;
      const transaction = database.transaction('completeSnapshots', 'readonly');
      const record = await indexedDbRequest<CompleteSnapshotRecord | undefined>(
        transaction.objectStore('completeSnapshots').get(key),
      );
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
      return result.success
        ? ({
            status: 'compatible',
            snapshot: result.output,
            synchronizedAt: record.synchronizedAt ?? null,
          } satisfies StoredBookmarkSnapshot)
        : ({
            status: 'incompatible',
            wireFormatVersion: record.wireFormatVersion,
          } satisfies StoredBookmarkSnapshot);
    },
    async writeSnapshot(snapshot: BookmarkSnapshot, metadata: { synchronizedAt: string }) {
      const validated = v.parse(bookmarkSnapshotSchema, snapshot);
      const database = await databasePromise;
      const transaction = database.transaction(['completeSnapshots', 'settings'], 'readwrite');
      const key = snapshotKey(validated);
      transaction.objectStore('completeSnapshots').put({
        key,
        wireFormatVersion: validated.wireFormatVersion,
        revision: validated.revision,
        snapshot: validated,
        synchronizedAt: metadata.synchronizedAt,
      } satisfies CompleteSnapshotRecord);
      transaction
        .objectStore('settings')
        .put({ key: 'activeSnapshotKey', value: key } satisfies Setting);
      hooks.beforeSnapshotCommit?.(transaction);
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
