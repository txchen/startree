export const RECENT_BOOKMARKS_LIMIT = 10;
export const RECENT_BOOKMARKS_SETTING = 'recentBookmarksV1';

export const normalizeRecentBookmarks = (value: unknown): string[] =>
  Array.isArray(value)
    ? [
        ...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0)),
      ].slice(0, RECENT_BOOKMARKS_LIMIT)
    : [];

export type RecentBookmarkStorage = {
  readRecentBookmarks(): Promise<string[]>;
  updateRecentBookmarks(id: string | null): Promise<string[]>;
};

// Resolve titles, URLs, and availability from the current library, never from history.
export const createRecentBookmarks = (storage: RecentBookmarkStorage) => {
  let retained: string[] = [];
  let sessionOnly = false;
  const read = async (): Promise<string[]> => {
    if (!sessionOnly) {
      try {
        retained = await storage.readRecentBookmarks();
      } catch {
        // Keep this session usable when browser storage is unavailable.
      }
    }
    return [...retained];
  };
  const update = async (id: string | null) => {
    retained = id === null ? [] : normalizeRecentBookmarks([id, ...retained]);
    if (!sessionOnly) {
      try {
        retained = await storage.updateRecentBookmarks(id);
      } catch {
        sessionOnly = true;
        // Persistence failure must never prevent native navigation.
      }
    }
    return [...retained];
  };
  return { read, record: (id: string) => update(id), clear: () => update(null) };
};
