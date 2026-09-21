export const resolvePagePath = (pathname: string): { matched: boolean; folderId?: string } => {
  if (pathname === '/') return { matched: true };
  const match = /^\/bookmarks(?:\/(.*?))?\/?$/i.exec(pathname);
  if (!match) return { matched: false };
  if (!match[1]) return { matched: true };
  try {
    return { matched: true, folderId: decodeURIComponent(match[1]) };
  } catch {
    return { matched: true, folderId: match[1] };
  }
};
