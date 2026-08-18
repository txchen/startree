import { describe, expect, it } from 'vitest';

import { pageRoutes, routes } from './routes';

describe('Page routes', () => {
  it('redirects the application root to Bookmarks', () => {
    expect(routes[0]).toMatchObject({ path: '/', redirect: '/bookmarks' });
  });

  it('keeps Bookmarks in the stable Page navigation', () => {
    expect(pageRoutes).toEqual([
      expect.objectContaining({
        name: 'bookmarks',
        path: '/bookmarks/:pathMatch(.*)*',
        meta: { navLabel: 'Bookmarks' },
      }),
    ]);
  });
});
