import { describe, expect, it } from 'vitest';
import * as v from 'valibot';

import {
  bookmarkCommandSchema,
  bookmarkFolderSchema,
  bookmarkSchema,
  normalizeBookmarkTags,
  SYSTEM_ROOT_FOLDER_ID,
} from './contracts';

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

describe('Bookmark command contract', () => {
  const operationId = 'a0000000-0000-4000-8000-000000000001';

  it.each([
    ['Folder name', 'name', 256],
    ['Bookmark title', 'title', 256],
    ['Bookmark URL', 'url', 8192],
    ['Bookmark Note', 'note', 32768],
  ])('validates %s below, at, and above its limit', (_label, field, limit) => {
    const base = {
      type: 'createBookmark' as const,
      operationId,
      folderId: SYSTEM_ROOT_FOLDER_ID,
      expectedBookmarkSequenceVersion: 1,
      url: 'https://example.com',
      title: 'Example',
      note: '',
      tags: [],
    };
    const command =
      field === 'name'
        ? {
            type: 'createFolder' as const,
            operationId,
            parentId: SYSTEM_ROOT_FOLDER_ID,
            expectedFolderSequenceVersion: 1,
            name: 'x',
          }
        : base;
    const value =
      field === 'url'
        ? (length: number) => `https://e.co/${'x'.repeat(length - 13)}`
        : (length: number) => 'x'.repeat(length);

    expect(
      v.safeParse(bookmarkCommandSchema, { ...command, [field]: value(limit - 1) }).success,
    ).toBe(true);
    expect(v.safeParse(bookmarkCommandSchema, { ...command, [field]: value(limit) }).success).toBe(
      true,
    );
    expect(
      v.safeParse(bookmarkCommandSchema, { ...command, [field]: value(limit + 1) }).success,
    ).toBe(false);
  });

  it('requires UUID v4 operation IDs and positive relevant versions', () => {
    const command = {
      type: 'editFolder' as const,
      operationId,
      folderId: '10000000-0000-4000-8000-000000000001',
      folderVersion: 1,
      name: 'Reading',
    };

    expect(v.safeParse(bookmarkCommandSchema, command).success).toBe(true);
    expect(
      v.safeParse(bookmarkCommandSchema, {
        ...command,
        operationId: 'a0000000-0000-3000-8000-000000000001',
      }).success,
    ).toBe(false);
    expect(v.safeParse(bookmarkCommandSchema, { ...command, folderVersion: 0 }).success).toBe(
      false,
    );
  });

  it.each([
    {
      type: 'reorderFolder',
      folderId: '10000000-0000-4000-8000-000000000001',
      folderVersion: 1,
      parentId: SYSTEM_ROOT_FOLDER_ID,
      expectedFolderSequenceVersion: 2,
      beforeFolderId: '10000000-0000-4000-8000-000000000002',
    },
    {
      type: 'moveFolder',
      folderId: '10000000-0000-4000-8000-000000000001',
      folderVersion: 1,
      sourceParentId: SYSTEM_ROOT_FOLDER_ID,
      destinationFolderId: '10000000-0000-4000-8000-000000000002',
      expectedSourceFolderSequenceVersion: 2,
      expectedDestinationFolderSequenceVersion: 3,
    },
    {
      type: 'reorderBookmark',
      bookmarkId: '20000000-0000-4000-8000-000000000001',
      bookmarkVersion: 1,
      folderId: SYSTEM_ROOT_FOLDER_ID,
      expectedBookmarkSequenceVersion: 2,
    },
    {
      type: 'moveBookmark',
      bookmarkId: '20000000-0000-4000-8000-000000000001',
      bookmarkVersion: 1,
      sourceFolderId: SYSTEM_ROOT_FOLDER_ID,
      destinationFolderId: '10000000-0000-4000-8000-000000000002',
      expectedSourceBookmarkSequenceVersion: 2,
      expectedDestinationBookmarkSequenceVersion: 3,
      beforeBookmarkId: '20000000-0000-4000-8000-000000000002',
    },
  ])('accepts the $type organization command contract', (command) => {
    expect(v.safeParse(bookmarkCommandSchema, { ...command, operationId }).success).toBe(true);
  });

  it('preserves Folder names and rejects blank values', () => {
    const command = {
      type: 'createFolder' as const,
      operationId,
      parentId: SYSTEM_ROOT_FOLDER_ID,
      expectedFolderSequenceVersion: 1,
      name: '  Reading  ',
    };

    expect(v.parse(bookmarkCommandSchema, command)).toMatchObject({ name: '  Reading  ' });
    expect(v.safeParse(bookmarkCommandSchema, { ...command, name: '   ' }).success).toBe(false);
  });

  it('normalizes Tags at the command boundary', () => {
    expect(normalizeBookmarkTags(['  Travel ', 'travel', 'CAFÉ', ' café '])).toEqual([
      'CAFÉ',
      'Travel',
    ]);
    expect(() => normalizeBookmarkTags(['   '])).toThrow();
    expect(() => normalizeBookmarkTags(['x'.repeat(65)])).toThrow();
    expect(() =>
      normalizeBookmarkTags(Array.from({ length: 51 }, (_, index) => `tag-${index}`)),
    ).toThrow();
    expect(
      normalizeBookmarkTags(Array.from({ length: 50 }, (_, index) => `tag-${index}`)),
    ).toHaveLength(50);
  });

  it('validates Tag length and count below, at, and above their limits', () => {
    expect(normalizeBookmarkTags(['x'.repeat(63)])).toEqual(['x'.repeat(63)]);
    expect(normalizeBookmarkTags(['x'.repeat(64)])).toEqual(['x'.repeat(64)]);
    expect(() => normalizeBookmarkTags(['x'.repeat(65)])).toThrow();
    expect(
      normalizeBookmarkTags(Array.from({ length: 49 }, (_, index) => `tag-${index}`)),
    ).toHaveLength(49);
    expect(
      normalizeBookmarkTags(Array.from({ length: 50 }, (_, index) => `tag-${index}`)),
    ).toHaveLength(50);
    expect(() =>
      normalizeBookmarkTags(Array.from({ length: 51 }, (_, index) => `tag-${index}`)),
    ).toThrow();
  });
});
