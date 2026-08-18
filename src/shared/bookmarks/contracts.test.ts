import { describe, expect, it } from 'vitest';
import * as v from 'valibot';

import { bookmarkFolderSchema, bookmarkSchema, SYSTEM_ROOT_FOLDER_ID } from './contracts';

const bookmark = {
  id: '20000000-0000-4000-8000-000000000001',
  folderId: '10000000-0000-4000-8000-000000000001',
  url: 'https://example.com',
  title: 'Example',
  note: '',
  rank: 'a',
  createdAt: '2026-08-18T12:00:00.000Z',
  modifiedAt: '2026-08-18T12:00:00.000Z',
  version: 1,
};

describe('Bookmark snapshot contract', () => {
  it('accepts only absolute HTTP and HTTPS Bookmark destinations', () => {
    expect(v.safeParse(bookmarkSchema, bookmark).success).toBe(true);
    expect(v.safeParse(bookmarkSchema, { ...bookmark, url: 'http://example.com' }).success).toBe(
      true,
    );
    expect(v.safeParse(bookmarkSchema, { ...bookmark, url: 'ftp://example.com' }).success).toBe(
      false,
    );
    expect(v.safeParse(bookmarkSchema, { ...bookmark, url: '/relative' }).success).toBe(false);
  });

  it('rejects a blank Bookmark title', () => {
    expect(v.safeParse(bookmarkSchema, { ...bookmark, title: '   ' }).success).toBe(false);
  });

  it('allows a blank name only for the system root Folder', () => {
    const folder = {
      id: '10000000-0000-4000-8000-000000000001',
      name: 'Reading',
      parentId: SYSTEM_ROOT_FOLDER_ID,
      rank: 'a',
      createdAt: '2026-08-18T12:00:00.000Z',
      modifiedAt: '2026-08-18T12:00:00.000Z',
      version: 1,
    };

    expect(v.safeParse(bookmarkFolderSchema, { ...folder, name: '   ' }).success).toBe(false);
    expect(
      v.safeParse(bookmarkFolderSchema, {
        ...folder,
        id: SYSTEM_ROOT_FOLDER_ID,
        name: '',
        parentId: null,
        rank: '0',
      }).success,
    ).toBe(true);
  });
});
