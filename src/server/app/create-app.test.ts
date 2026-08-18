import { describe, expect, it, vi } from 'vitest';

import {
  SYSTEM_ROOT_FOLDER_ID,
  type BookmarkCommandResult,
  type BookmarkSnapshot,
  type BookmarkTrash,
} from '../../shared/bookmarks/contracts';
import { createApp } from './create-app';

const bindings = {
  APP_VERSION: 'test-version',
  ASSETS: { fetch: () => Promise.resolve(new Response('asset')) },
  MUTATION_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
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

const trash: BookmarkTrash = {
  wireFormatVersion: 1,
  revision: 7,
  roots: [],
  folders: [],
  bookmarks: [],
  tags: [],
};

const createTestApp = () =>
  createApp<typeof bindings>({
    readBookmarkRevision: () => Promise.resolve(7),
    readBookmarkSnapshot: () => Promise.resolve(snapshot),
    readBookmarkTrash: () => Promise.resolve(trash),
    executeBookmarkCommand: (command) =>
      Promise.resolve({
        status: 'acknowledged',
        operationId: command.operationId,
        revision: 8,
        folders: [],
        bookmarks: [],
        tags: [],
        sequences: [],
      } satisfies BookmarkCommandResult),
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

  it('sanitizes exception diagnostics without exposing exception messages or causes', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createApp<typeof bindings>({
      readBookmarkRevision: () =>
        Promise.reject(
          new TypeError('Owner title must stay private', {
            cause: new Error('Owner Note must stay private'),
          }),
        ),
      readBookmarkSnapshot: () => Promise.resolve(snapshot),
      readBookmarkTrash: () => Promise.resolve(trash),
      executeBookmarkCommand: () => Promise.reject(new Error('unused')),
    });

    const response = await app.request('/api/v1/platform', undefined, bindings);
    const text = await response.text();
    const logged = log.mock.calls.flat().join(' ');
    log.mockRestore();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toMatchObject({
      error: {
        code: 'internal_error',
        operation: 'request',
        exceptionType: 'TypeError',
        causeChain: ['TypeError', 'Error'],
      },
    });
    expect(JSON.parse(text).error.sanitizedStack).toBeInstanceOf(Array);
    expect(`${text}${logged}`).not.toContain('Owner title');
    expect(`${text}${logged}`).not.toContain('Owner Note');
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

  it('returns validated online-only Trash with revision invalidation', async () => {
    const response = await createTestApp().request('/api/bookmarks/trash', undefined, bindings);
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"bookmark-trash-1-7"');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual(trash);

    const unchanged = await createTestApp().request(
      '/api/bookmarks/trash',
      { headers: { 'If-None-Match': '"bookmark-trash-1-7"' } },
      bindings,
    );
    expect(unchanged.status).toBe(304);
  });

  it('validates and executes a shared Bookmark command', async () => {
    const response = await createTestApp().request(
      'http://startree.local/api/bookmarks/commands',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://startree.local' },
        body: JSON.stringify({
          type: 'createFolder',
          operationId: 'a0000000-0000-4000-8000-000000000001',
          parentId: SYSTEM_ROOT_FOLDER_ID,
          expectedFolderSequenceVersion: 1,
          name: 'Reading',
        }),
      },
      bindings,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'acknowledged',
      operationId: 'a0000000-0000-4000-8000-000000000001',
      revision: 8,
    });
  });

  it('returns a structured retry response when the mutation rate limit is exhausted', async () => {
    const limitedBindings = {
      ...bindings,
      MUTATION_RATE_LIMITER: { limit: () => Promise.resolve({ success: false }) },
    };
    const response = await createTestApp().request(
      'http://startree.local/api/bookmarks/commands',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://startree.local' },
        body: '{}',
      },
      limitedBindings,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'rate_limited', operation: 'bookmark_command', retryAfterSeconds: 60 },
    });
  });

  it('does not enable cross-origin API reads', async () => {
    const response = await createTestApp().request(
      'http://startree.local/api/bookmarks/snapshot',
      { headers: { Origin: 'https://attacker.example' } },
      bindings,
    );

    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('maps structured command conflicts to 409', async () => {
    const app = createApp<typeof bindings>({
      readBookmarkRevision: () => Promise.resolve(7),
      readBookmarkSnapshot: () => Promise.resolve(snapshot),
      readBookmarkTrash: () => Promise.resolve(trash),
      executeBookmarkCommand: (command) =>
        Promise.resolve({
          status: 'conflict',
          operationId: command.operationId,
          code: 'stale_entity',
          revision: 7,
          folders: [],
          bookmarks: [],
          tags: [],
          sequences: [],
        }),
    });
    const response = await app.request(
      'http://startree.local/api/bookmarks/commands',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://startree.local' },
        body: JSON.stringify({
          type: 'editFolder',
          operationId: 'a0000000-0000-4000-8000-000000000002',
          folderId: '10000000-0000-4000-8000-000000000001',
          folderVersion: 1,
          name: 'Saved',
        }),
      },
      bindings,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      status: 'conflict',
      code: 'stale_entity',
    });
  });

  it('returns safe operation diagnostics when command execution fails', async () => {
    const app = createApp<typeof bindings>({
      readBookmarkRevision: () => Promise.resolve(7),
      readBookmarkSnapshot: () => Promise.resolve(snapshot),
      readBookmarkTrash: () => Promise.resolve(trash),
      executeBookmarkCommand: () => Promise.reject(new TypeError('private Bookmark title')),
    });
    const response = await app.request(
      'http://startree.local/api/bookmarks/commands',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://startree.local' },
        body: JSON.stringify({
          type: 'createFolder',
          operationId: 'a0000000-0000-4000-8000-000000000005',
          parentId: SYSTEM_ROOT_FOLDER_ID,
          expectedFolderSequenceVersion: 1,
          name: 'Reading',
        }),
      },
      bindings,
    );
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toMatchObject({
      error: {
        code: 'internal_error',
        operation: 'createFolder',
        operationId: 'a0000000-0000-4000-8000-000000000005',
        exceptionType: 'TypeError',
      },
    });
    expect(text).not.toContain('private Bookmark title');
  });

  it.each([
    [
      { 'Content-Type': 'text/plain', Origin: 'http://startree.local' },
      415,
      'unsupported_media_type',
    ],
    [
      { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
      403,
      'invalid_origin',
    ],
    [
      {
        'Content-Type': 'application/json',
        Origin: 'http://startree.local',
        'Content-Length': String(1024 * 1024 + 1),
      },
      413,
      'request_too_large',
    ],
  ])('rejects an unsafe command request', async (headers, status, code) => {
    const response = await createTestApp().request(
      'http://startree.local/api/bookmarks/commands',
      { method: 'POST', headers, body: '{}' },
      bindings,
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
  });

  it('returns a structured validation error for malformed commands', async () => {
    const response = await createTestApp().request(
      'http://startree.local/api/bookmarks/commands',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://startree.local' },
        body: JSON.stringify({ type: 'createFolder' }),
      },
      bindings,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_command' } });
  });

  it('rejects an oversized streamed command without trusting Content-Length', async () => {
    const response = await createTestApp().request(
      'http://startree.local/api/bookmarks/commands',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://startree.local' },
        body: 'x'.repeat(1024 * 1024 + 1),
      },
      bindings,
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'request_too_large' } });
  });
});
