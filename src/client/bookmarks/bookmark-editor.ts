export type BookmarkEditorValue = {
  name?: string;
  url?: string;
  title?: string;
  note?: string;
  tags?: string[];
};

export const bookmarkEditorError = (kind: 'folder' | 'bookmark', value: BookmarkEditorValue) => {
  if (kind === 'folder') {
    if (!value.name?.trim()) return { field: 'name', message: 'Enter a Folder name.' };
    return;
  }
  const url = value.url ?? '';
  if (!URL.canParse(url) || !['http:', 'https:'].includes(new URL(url).protocol)) {
    return { field: 'url', message: 'Enter a valid HTTP or HTTPS URL.' };
  }
  if (!value.title?.trim()) return { field: 'title', message: 'Enter a Bookmark title.' };
  const tags = value.tags ?? [];
  if (tags.length > 50) return { field: 'tags', message: 'Enter up to 50 Tags.' };
  if (tags.some((tag) => tag.trim().length > 64)) {
    return { field: 'tags', message: 'Use 64 characters or fewer per Tag.' };
  }
};
