import type { Bookmark, BookmarkFolder } from '../../shared/bookmarks/contracts';

export type BookmarkFacet = Readonly<{
  value: string;
  count: number;
}>;

export type BookmarkFacets = Readonly<{
  tags: readonly BookmarkFacet[];
  domains: readonly BookmarkFacet[];
}>;

export type BookmarkDuplicateGroup = Readonly<{
  url: string;
  bookmarks: readonly Bookmark[];
}>;

export const recursiveBookmarkCountsByFolder = (
  folders: readonly BookmarkFolder[],
  bookmarks: readonly Bookmark[],
): Readonly<Record<string, number>> => {
  const directCounts = new Map(folders.map((folder) => [folder.id, 0]));
  const childIdsByFolder = new Map<string, string[]>();

  for (const folder of folders) {
    if (!folder.parentId) continue;
    const childIds = childIdsByFolder.get(folder.parentId) ?? [];
    childIds.push(folder.id);
    childIdsByFolder.set(folder.parentId, childIds);
  }
  for (const bookmark of bookmarks) {
    const count = directCounts.get(bookmark.folderId);
    if (count !== undefined) directCounts.set(bookmark.folderId, count + 1);
  }

  const counts = new Map<string, number>();
  const resolving = new Set<string>();
  const resolve = (folderId: string): number => {
    const existing = counts.get(folderId);
    if (existing !== undefined) return existing;
    if (resolving.has(folderId)) return directCounts.get(folderId) ?? 0;

    resolving.add(folderId);
    const count = (childIdsByFolder.get(folderId) ?? []).reduce(
      (total, childId) => total + resolve(childId),
      directCounts.get(folderId) ?? 0,
    );
    resolving.delete(folderId);
    counts.set(folderId, count);
    return count;
  };

  for (const folder of folders) resolve(folder.id);
  return Object.fromEntries(counts);
};

export const bookmarkFolderPaths = (
  folders: readonly BookmarkFolder[],
): Readonly<Record<string, string>> => {
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const paths = new Map<string, string>();
  const resolving = new Set<string>();
  const resolve = (folderId: string): string | undefined => {
    const existing = paths.get(folderId);
    if (existing) return existing;
    const folder = foldersById.get(folderId);
    if (!folder || resolving.has(folderId)) return undefined;
    resolving.add(folderId);
    const name = folder.name || 'Bookmarks';
    const path = folder.parentId ? `${resolve(folder.parentId) ?? 'Bookmarks'} / ${name}` : name;
    resolving.delete(folderId);
    paths.set(folderId, path);
    return path;
  };
  for (const folder of folders) resolve(folder.id);
  return Object.fromEntries(paths);
};

export const bookmarkDomain = (url: string): string => new URL(url).hostname.toLocaleLowerCase();

const sortedFacets = (counts: Map<string, { value: string; count: number }>): BookmarkFacet[] =>
  [...counts.values()].sort(
    (left, right) =>
      right.count - left.count ||
      left.value.toLocaleLowerCase().localeCompare(right.value.toLocaleLowerCase()) ||
      left.value.localeCompare(right.value),
  );

export const bookmarkFacetsFor = (
  bookmarks: readonly Bookmark[],
  tagsByBookmark: Readonly<Record<string, readonly string[]>>,
): BookmarkFacets => {
  const tagCounts = new Map<string, { value: string; count: number }>();
  const domainCounts = new Map<string, { value: string; count: number }>();

  for (const bookmark of bookmarks) {
    const domain = bookmarkDomain(bookmark.url);
    const domainFacet = domainCounts.get(domain);
    if (domainFacet) domainFacet.count += 1;
    else domainCounts.set(domain, { value: domain, count: 1 });

    const seenTags = new Set<string>();
    for (const tag of tagsByBookmark[bookmark.id] ?? []) {
      const key = tag.toLocaleLowerCase();
      if (seenTags.has(key)) continue;
      seenTags.add(key);
      const tagFacet = tagCounts.get(key);
      if (tagFacet) tagFacet.count += 1;
      else tagCounts.set(key, { value: tag, count: 1 });
    }
  }

  return { tags: sortedFacets(tagCounts), domains: sortedFacets(domainCounts) };
};

export const bookmarksMatchingUrl = (
  bookmarks: readonly Bookmark[],
  url: string,
  excludedBookmarkId?: string,
): Bookmark[] => {
  const candidate = url.trim();
  if (!candidate) return [];
  return bookmarks.filter(
    (bookmark) => bookmark.id !== excludedBookmarkId && bookmark.url === candidate,
  );
};

export const duplicateBookmarkGroups = (
  bookmarks: readonly Bookmark[],
): BookmarkDuplicateGroup[] => {
  const grouped = new Map<string, Bookmark[]>();
  for (const bookmark of bookmarks) {
    const matches = grouped.get(bookmark.url) ?? [];
    matches.push(bookmark);
    grouped.set(bookmark.url, matches);
  }

  return [...grouped]
    .filter(([, matches]) => matches.length > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([url, matches]) => ({
      url,
      bookmarks: matches.sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      ),
    }));
};
