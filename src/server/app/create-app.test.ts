import { describe, expect, it } from 'vitest';

import { SYSTEM_ROOT_FOLDER_ID, type BookmarkSnapshot } from '../../shared/bookmarks/contracts';
import { createApp } from './create-app';

const bindings = {
  APP_VERSION: 'test-version',
  ASSETS: { fetch: () => Promise.resolve(new Response('asset')) },
};

const snapshot: BookmarkSnapshot = {
  wireFormatVersion: 1,
  revision: 7,
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
  ],
  bookmarks: [],
  tags: [],
  sequences: [{ folderId: SYSTEM_ROOT_FOLDER_ID, folderVersion: 1, bookmarkVersion: 1 }],
};

const createTestApp = () =>
  createApp<typeof bindings>({
    readBookmarkRevision: () => Promise.resolve(7),
    readBookmarkSnapshot: () => Promise.resolve(snapshot),
  });

describe('platform API', () => {
  it('returns a versioned status backed by D1', async () => {
    const response = await createTestApp().request('/api/v1/platform', undefined, bindings);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      apiVersion: 1,
      application: 'startree',
      bookmarkRevision: 7,
      version: 'test-version',
    });
  });

  it('returns the shared structured envelope for missing API routes', async () => {
    const response = await createTestApp().request('/api/missing', undefined, bindings);
    const body = (await response.json()) as { error: { code: string; requestId: string } };

    expect(response.status).toBe(404);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(body.error.code).toBe('not_found');
    expect(body.error.requestId).toBeTruthy();
  });

  it('delegates client routes to the static asset binding', async () => {
    const response = await createTestApp().request('/bookmarks/folder', undefined, bindings);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('asset');
  });

  it('returns the shared validated Bookmark snapshot with a private ETag', async () => {
    const response = await createTestApp().request('/api/bookmarks/snapshot', undefined, bindings);

    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"bookmarks-1-7"');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual(snapshot);
  });

  it('returns 304 when the Bookmark snapshot ETag matches', async () => {
    const response = await createTestApp().request(
      '/api/bookmarks/snapshot',
      { headers: { 'If-None-Match': '"bookmarks-1-7"' } },
      bindings,
    );

    expect(response.status).toBe(304);
    expect(response.headers.get('etag')).toBe('"bookmarks-1-7"');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.text()).resolves.toBe('');
  });
});
