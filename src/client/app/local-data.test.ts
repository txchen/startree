import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';

import {
  APPLICATION_SHELL_NAVIGATION_DENYLIST,
  applicationCacheName,
  clearLocalApplicationData,
  readRetainedSnapshotCompatibility,
  shellCanActivate,
} from './local-data';

describe('Service Worker and local data boundaries', () => {
  it('never intercepts API or Cloudflare Access logout navigation', () => {
    const isDenied = (path: string) =>
      APPLICATION_SHELL_NAVIGATION_DENYLIST.some((pattern) => pattern.test(path));

    expect(isDenied('/api/bookmarks/snapshot')).toBe(true);
    expect(isDenied('/cdn-cgi/access/logout')).toBe(true);
    expect(isDenied('/bookmarks/folder-id')).toBe(false);
  });

  it('activates the shell only with no snapshot or a compatible snapshot', () => {
    expect(shellCanActivate({ status: 'empty' })).toBe(true);
    expect(shellCanActivate({ status: 'compatible', wireFormatVersion: 1 })).toBe(true);
    expect(shellCanActivate({ status: 'incompatible', wireFormatVersion: 99 })).toBe(false);
  });

  it('reads compatibility from the atomic active snapshot pointer', async () => {
    const indexedDb = new IDBFactory();
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDb.open('startree-bookmarks', 2);
      request.addEventListener('upgradeneeded', () => {
        request.result.createObjectStore('settings', { keyPath: 'key' });
        request.result.createObjectStore('completeSnapshots', { keyPath: 'key' });
      });
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
    const writeCompatibility = async (wireFormatVersion: number) => {
      const transaction = database.transaction(['settings', 'completeSnapshots'], 'readwrite');
      transaction.objectStore('completeSnapshots').put({
        key: `${wireFormatVersion}:1`,
        wireFormatVersion,
      });
      transaction
        .objectStore('settings')
        .put({ key: 'activeSnapshotKey', value: `${wireFormatVersion}:1` });
      await new Promise<void>((resolve) =>
        transaction.addEventListener('complete', () => resolve(), { once: true }),
      );
    };

    await writeCompatibility(1);
    await expect(readRetainedSnapshotCompatibility(indexedDb)).resolves.toEqual({
      status: 'compatible',
      wireFormatVersion: 1,
    });
    await writeCompatibility(99);
    await expect(readRetainedSnapshotCompatibility(indexedDb)).resolves.toEqual({
      status: 'incompatible',
      wireFormatVersion: 99,
    });
    database.close();
  });

  it('clears IndexedDB, application caches, and Service Worker registrations in order', async () => {
    const events: string[] = [];
    const cacheStorage = {
      keys: vi.fn(() => Promise.resolve([applicationCacheName('precache'), 'unrelated-cache'])),
      delete: vi.fn(async (name: string) => {
        events.push(`cache:${name}`);
        return true;
      }),
    };
    const registration = {
      unregister: vi.fn(async () => {
        events.push('service-worker');
        return true;
      }),
    };

    await clearLocalApplicationData({
      clearIndexedDb: async () => {
        events.push('indexeddb');
      },
      cacheStorage,
      serviceWorkerRegistrations: async () => [registration],
    });

    expect(events).toEqual([
      'indexeddb',
      `cache:${applicationCacheName('precache')}`,
      'service-worker',
    ]);
    expect(cacheStorage.delete).not.toHaveBeenCalledWith('unrelated-cache');
  });
});
