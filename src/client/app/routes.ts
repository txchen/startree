import type { RouteRecordRaw } from 'vue-router';

import BookmarksPage from '../bookmarks/BookmarksPage.vue';

export const pageRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    alias: '/bookmarks',
    name: 'bookmarks',
    component: BookmarksPage,
    meta: { navLabel: 'Bookmarks' },
  },
];

export const routes: RouteRecordRaw[] = [
  ...pageRoutes,
  {
    path: '/bookmarks/:pathMatch(.*)+',
    name: 'legacy-bookmark-folder',
    component: BookmarksPage,
  },
];
