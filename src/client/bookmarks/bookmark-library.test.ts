import { describe, expect, it } from 'vitest';

import { SYSTEM_ROOT_FOLDER_ID, type Bookmark } from '../../shared/bookmarks/contracts';
import {
  bookmarkFolderPaths,
  bookmarkFacetsFor,
  bookmarksMatchingUrl,
  duplicateBookmarkGroups,
} from './bookmark-library';

const bookmark = (id: string, url: string, createdAt = '2026-08-18T00:00:00.000Z'): Bookmark => ({
  id,
  folderId: '10000000-0000-4000-8000-000000000001',
  url,
  title: id,
  note: '',
  rank: id,
  createdAt,
  modifiedAt: createdAt,
  version: 1,
});

const firstId = '20000000-0000-4000-8000-000000000001';
const secondId = '20000000-0000-4000-8000-000000000002';
const thirdId = '20000000-0000-4000-8000-000000000003';

describe('Bookmark library lenses', () => {
  it('builds complete Folder paths once for library-wide views', () => {
    expect(
      bookmarkFolderPaths([
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
          id: '10000000-0000-4000-8000-000000000001',
          name: 'Reading',
          parentId: SYSTEM_ROOT_FOLDER_ID,
          rank: 'a',
          createdAt: '2026-08-18T00:00:00.000Z',
          modifiedAt: '2026-08-18T00:00:00.000Z',
          version: 1,
        },
      ]),
    ).toEqual({
      [SYSTEM_ROOT_FOLDER_ID]: 'Bookmarks',
      '10000000-0000-4000-8000-000000000001': 'Bookmarks / Reading',
    });
  });

  it('counts Tag and domain facets with stable, case-insensitive Tag grouping', () => {
    const bookmarks = [
      bookmark(firstId, 'https://www.example.com/one'),
      bookmark(secondId, 'https://www.example.com/two'),
      bookmark(thirdId, 'https://another.example/three'),
    ];

    expect(
      bookmarkFacetsFor(bookmarks, {
        [firstId]: ['Reference', 'Work'],
        [secondId]: ['reference'],
        [thirdId]: ['Personal'],
      }),
    ).toEqual({
      tags: [
        { value: 'Reference', count: 2 },
        { value: 'Personal', count: 1 },
        { value: 'Work', count: 1 },
      ],
      domains: [
        { value: 'www.example.com', count: 2 },
        { value: 'another.example', count: 1 },
      ],
    });
  });

  it('finds exact URL matches while excluding the Bookmark being edited', () => {
    const bookmarks = [
      bookmark(firstId, 'https://example.com'),
      bookmark(secondId, 'https://example.com'),
      bookmark(thirdId, 'https://example.com/'),
    ];

    expect(
      bookmarksMatchingUrl(bookmarks, ' https://example.com ', firstId).map(({ id }) => id),
    ).toEqual([secondId]);
  });

  it('returns only exact duplicate groups in deterministic order', () => {
    const bookmarks = [
      bookmark(secondId, 'https://example.com', '2026-08-19T00:00:00.000Z'),
      bookmark(thirdId, 'https://another.example'),
      bookmark(firstId, 'https://example.com', '2026-08-18T00:00:00.000Z'),
    ];

    expect(duplicateBookmarkGroups(bookmarks)).toEqual([
      {
        url: 'https://example.com',
        bookmarks: [bookmarks[2], bookmarks[0]],
      },
    ]);
  });
});
