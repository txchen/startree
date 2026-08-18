import { describe, expect, it } from 'vitest';

import { createApp } from './create-app';

const bindings = {
  APP_VERSION: 'test-version',
  ASSETS: { fetch: () => Promise.resolve(new Response('asset')) },
};

const createTestApp = () => createApp<typeof bindings>(() => Promise.resolve(7));

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
});
