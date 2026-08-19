import { describe, expect, it } from 'vitest';

import { SYSTEM_ROOT_FOLDER_ID, type BookmarkSnapshot } from '../../shared/bookmarks/contracts';
import { BOOKMARK_SEARCH_RESULT_LIMIT, createMiniSearchBookmarkAdapter } from './bookmark-search';

const folderId = '10000000-0000-4000-8000-000000000001';
const childFolderId = '10000000-0000-4000-8000-000000000002';

const snapshot = (revision = 1): BookmarkSnapshot => ({
  wireFormatVersion: 1,
  revision,
  folders: [
    {
      id: SYSTEM_ROOT_FOLDER_ID,
      name: '',
      parentId: null,
      rank: '0',
      createdAt: '1970-01-01T00:00:00.000Z',
      modifiedAt: '1970-01-01T00:00:00.000Z',
      version: 1,
    },
    {
      id: folderId,
      name: 'Research',
      parentId: SYSTEM_ROOT_FOLDER_ID,
      rank: 'a',
      createdAt: '2026-08-18T00:00:00.000Z',
      modifiedAt: '2026-08-18T00:00:00.000Z',
      version: 1,
    },
    {
      id: childFolderId,
      name: 'Browsers',
      parentId: folderId,
      rank: 'a',
      createdAt: '2026-08-18T00:00:00.000Z',
      modifiedAt: '2026-08-18T00:00:00.000Z',
      version: 1,
    },
  ],
  bookmarks: [
    {
      id: '20000000-0000-4000-8000-000000000001',
      folderId: childFolderId,
      url: 'https://title.example/guide',
      title: 'Needle handbook',
      note: 'Ordinary notes',
      rank: 'a',
      createdAt: '2026-08-18T00:00:00.000Z',
      modifiedAt: '2026-08-18T00:00:00.000Z',
      version: 1,
    },
    {
      id: '20000000-0000-4000-8000-000000000002',
      folderId: folderId,
      url: 'https://notes.example/archive',
      title: 'Archive',
      note: 'A needle appears only in this Note',
      rank: 'b',
      createdAt: '2026-08-18T00:00:00.000Z',
      modifiedAt: '2026-08-18T00:00:00.000Z',
      version: 1,
    },
  ],
  tags: [{ bookmarkId: '20000000-0000-4000-8000-000000000001', value: 'Café' }],
  sequences: [],
});

describe('Bookmark search Adapter Interface', () => {
  it('searches Folder names and all Bookmark fields with full Folder paths', async () => {
    const search = createMiniSearchBookmarkAdapter();
    await search.replace(snapshot());

    await expect(search.search('Browsers')).resolves.toContainEqual({
      kind: 'folder',
      id: childFolderId,
      title: 'Browsers',
      folderId: childFolderId,
      folderPath: 'Bookmarks / Research / Browsers',
    });
    expect(await search.search('title.example')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'bookmark',
          id: '20000000-0000-4000-8000-000000000001',
          folderPath: 'Bookmarks / Research / Browsers',
          context: { label: 'URL', text: 'title.example' },
        }),
      ]),
    );
    await expect(search.search('Café')).resolves.toMatchObject([
      {
        id: '20000000-0000-4000-8000-000000000001',
        tags: ['Café'],
        context: { label: 'Tag', text: 'Café' },
      },
    ]);
    await expect(search.search('needle')).resolves.toHaveLength(2);
  });

  it('ranks Bookmark title matches above Note-only matches', async () => {
    const search = createMiniSearchBookmarkAdapter();
    await search.replace(snapshot());

    const results = await search.search('needle');

    expect(results.map((result) => result.id)).toEqual([
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
    ]);
    expect(results[0]).not.toHaveProperty('context');
    expect(results[1]).toMatchObject({
      context: { label: 'Note', text: 'A needle appears only in this Note' },
    });
  });

  it('returns only the highest-ranked result window', async () => {
    const search = createMiniSearchBookmarkAdapter();
    const source = snapshot();
    await search.replace({
      ...source,
      bookmarks: Array.from({ length: BOOKMARK_SEARCH_RESULT_LIMIT + 5 }, (_, index) => ({
        ...source.bookmarks[0]!,
        id: `20000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
        title: `Shared result ${index}`,
        rank: String(index).padStart(4, '0'),
      })),
      tags: [],
    });

    await expect(search.search('Shared')).resolves.toHaveLength(BOOKMARK_SEARCH_RESULT_LIMIT);
  });

  it('disposes the previous revision index when a replacement arrives', async () => {
    const search = createMiniSearchBookmarkAdapter();
    await search.replace(snapshot(1));
    await expect(search.search('handbook')).resolves.toHaveLength(1);

    await search.replace({ ...snapshot(2), bookmarks: [], tags: [] });

    await expect(search.search('handbook')).resolves.toEqual([]);
    expect(search.revision()).toBe(2);
  });

  it('excludes records that are not reachable from the active Folder tree', async () => {
    const search = createMiniSearchBookmarkAdapter();
    const unreachableFolderId = '90000000-0000-4000-8000-000000000001';
    const source = snapshot();
    await search.replace({
      ...source,
      folders: [
        ...source.folders,
        {
          ...source.folders[1]!,
          id: unreachableFolderId,
          name: 'Trashed secret',
          parentId: '90000000-0000-4000-8000-000000000002',
        },
      ],
      bookmarks: [
        ...source.bookmarks,
        {
          ...source.bookmarks[0]!,
          id: '90000000-0000-4000-8000-000000000003',
          folderId: unreachableFolderId,
          title: 'Trashed secret',
        },
      ],
    });

    await expect(search.search('Trashed secret')).resolves.toEqual([]);
  });
});
