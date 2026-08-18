import type { RouteRecordRaw } from 'vue-router';

import BookmarksPage from '../bookmarks/BookmarksPage.vue';

export const pageRoutes: RouteRecordRaw[] = [
  {
    path: '/bookmarks/:pathMatch(.*)*',
    name: 'bookmarks',
    component: BookmarksPage,
    meta: { navLabel: 'Bookmarks' },
  },
];

export const routes: RouteRecordRaw[] = [{ path: '/', redirect: '/bookmarks' }, ...pageRoutes];
