import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createIndexedDbBookmarkAdapter } from './bookmark-adapters';
import {
  createRecentBookmarks,
  normalizeRecentBookmarks,
  RECENT_BOOKMARKS_LIMIT,
} from './recent-bookmarks';

describe('browser-local recent Bookmarks', () => {
  it('persists a bounded unique list with reopened Bookmarks first', async () => {
    const indexedDb = new IDBFactory();
    const storage = createIndexedDbBookmarkAdapter(indexedDb);
    const recent = createRecentBookmarks(storage);
    for (let i = 0; i < 15; i++) await recent.record(`bookmark-${i}`);
    const ids = await recent.record('bookmark-10');
    expect(ids).toHaveLength(RECENT_BOOKMARKS_LIMIT);
    expect(ids.slice(0, 3)).toEqual(['bookmark-10', 'bookmark-14', 'bookmark-13']);
    expect(new Set(ids).size).toBe(RECENT_BOOKMARKS_LIMIT);
    expect(await createRecentBookmarks(createIndexedDbBookmarkAdapter(indexedDb)).read()).toEqual(
      ids,
    );
    expect(ids).not.toContain('bookmark-0');
  });

  it('serializes concurrent tab writes and observes clearing without resurrecting entries', async () => {
    const indexedDb = new IDBFactory();
    const first = createRecentBookmarks(createIndexedDbBookmarkAdapter(indexedDb));
    const second = createRecentBookmarks(createIndexedDbBookmarkAdapter(indexedDb));
    await Promise.all([first.read(), second.read()]);
    await Promise.all([first.record('one'), second.record('two')]);
    expect(await first.read()).toEqual(['two', 'one']);
    await first.clear();
    expect(await second.read()).toEqual([]);
    expect(await second.record('three')).toEqual(['three']);
  });

  it('keeps session history when persistence fails and never rejects into navigation', async () => {
    const recent = createRecentBookmarks({
      readRecentBookmarks: async () => [],
      updateRecentBookmarks: async () => {
        throw new Error('Storage blocked');
      },
    });
    await recent.record('one');
    expect(await recent.record('two')).toEqual(['two', 'one']);
    expect(await recent.read()).toEqual(['two', 'one']);
    expect(await recent.clear()).toEqual([]);
  });

  it('filters malformed or duplicate retained entries', () => {
    expect(normalizeRecentBookmarks(undefined)).toEqual([]);
    expect(normalizeRecentBookmarks([null, 1, 'one', 'one', 'two', ''])).toEqual(['one', 'two']);
    expect(normalizeRecentBookmarks({})).toEqual([]);
  });
});
