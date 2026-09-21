import { describe, expect, it } from 'vitest';

import { pageRoutes, routes } from './routes';

describe('Page routes', () => {
  it('opens Bookmarks at the application root without redirecting', () => {
    expect(routes[0]).toMatchObject({ path: '/', name: 'bookmarks' });
    expect(routes[0]).not.toHaveProperty('redirect');
  });

  it('keeps Bookmarks in the stable Page navigation', () => {
    expect(pageRoutes).toEqual([
      expect.objectContaining({
        name: 'bookmarks',
        path: '/',
        alias: '/bookmarks',
        meta: { navLabel: 'Bookmarks' },
      }),
    ]);
  });

  it('keeps old Folder links available for migration to local navigation', () => {
    expect(routes[1]).toMatchObject({
      path: '/bookmarks/:pathMatch(.*)+',
      component: pageRoutes[0]?.component,
    });
  });
});
