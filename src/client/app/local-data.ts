import { BOOKMARK_SNAPSHOT_WIRE_FORMAT_VERSION } from '../../shared/bookmarks/contracts';
import { indexedDbRequest } from './indexed-db';

export const APPLICATION_CACHE_PREFIX = 'startree';
export const SHELL_COMPATIBILITY_VERSION = 1;
export const BOOKMARK_DATABASE_NAME = 'startree-bookmarks';
export const APPLICATION_SHELL_NAVIGATION_DENYLIST = [/^\/api\//, /^\/cdn-cgi\/access\//];

export const applicationCacheName = (kind: string): string =>
  `${APPLICATION_CACHE_PREFIX}-${kind}-shell-v${SHELL_COMPATIBILITY_VERSION}`;

export type RetainedSnapshotCompatibility =
  | { status: 'empty' }
  | { status: 'compatible'; wireFormatVersion: number }
  | { status: 'incompatible'; wireFormatVersion: number | null };

export const shellCanActivate = (snapshot: RetainedSnapshotCompatibility): boolean =>
  snapshot.status !== 'incompatible';

export const readRetainedSnapshotCompatibility = async (
  indexedDb: IDBFactory = indexedDB,
): Promise<RetainedSnapshotCompatibility> => {
  const database = await indexedDbRequest(indexedDb.open(BOOKMARK_DATABASE_NAME));
  try {
    if (!database.objectStoreNames.contains('settings')) return { status: 'empty' };
    const transaction = database.transaction('settings', 'readonly');
    const settings = transaction.objectStore('settings');
    const activeKey = (await indexedDbRequest(settings.get('activeSnapshotKey'))) as
      | { value?: unknown }
      | undefined;
    if (
      typeof activeKey?.value === 'string' &&
      database.objectStoreNames.contains('completeSnapshots')
    ) {
      const record = (await indexedDbRequest(
        database
          .transaction('completeSnapshots', 'readonly')
          .objectStore('completeSnapshots')
          .get(activeKey.value),
      )) as { wireFormatVersion?: unknown } | undefined;
      const wireFormatVersion =
        typeof record?.wireFormatVersion === 'number' ? record.wireFormatVersion : null;
      return wireFormatVersion === BOOKMARK_SNAPSHOT_WIRE_FORMAT_VERSION
        ? { status: 'compatible', wireFormatVersion }
        : { status: 'incompatible', wireFormatVersion };
    }

    const activeRevision = (await indexedDbRequest(settings.get('activeSnapshotRevision'))) as
      | { value?: unknown }
      | undefined;
    if (
      typeof activeRevision?.value === 'number' &&
      database.objectStoreNames.contains('snapshots')
    ) {
      const snapshot = (await indexedDbRequest(
        database
          .transaction('snapshots', 'readonly')
          .objectStore('snapshots')
          .get(activeRevision.value),
      )) as { wireFormatVersion?: unknown } | undefined;
      const wireFormatVersion =
        typeof snapshot?.wireFormatVersion === 'number' ? snapshot.wireFormatVersion : null;
      return wireFormatVersion === BOOKMARK_SNAPSHOT_WIRE_FORMAT_VERSION
        ? { status: 'compatible', wireFormatVersion }
        : { status: 'incompatible', wireFormatVersion };
    }
    return { status: 'empty' };
  } finally {
    database.close();
  }
};

type CacheStorageBoundary = {
  keys(): Promise<readonly string[]>;
  delete(name: string): Promise<boolean>;
};

type ServiceWorkerRegistrationBoundary = { unregister(): Promise<boolean> };

export const clearLocalApplicationData = async (boundaries: {
  clearIndexedDb(): Promise<void>;
  cacheStorage: CacheStorageBoundary;
  serviceWorkerRegistrations(): Promise<readonly ServiceWorkerRegistrationBoundary[]>;
}): Promise<void> => {
  await boundaries.clearIndexedDb();
  const cacheNames = await boundaries.cacheStorage.keys();
  await Promise.all(
    cacheNames
      .filter((name) => name.startsWith(`${APPLICATION_CACHE_PREFIX}-`))
      .map((name) => boundaries.cacheStorage.delete(name)),
  );
  const registrations = await boundaries.serviceWorkerRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
};
