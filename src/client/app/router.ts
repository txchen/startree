import { createRouter, createWebHistory } from 'vue-router';

import { routes } from './routes';

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

declare module 'vue-router' {
  interface RouteMeta {
    navLabel?: string;
  }
}
