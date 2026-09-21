/// <reference lib="webworker" />

import { clientsClaim, setCacheNameDetails } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

import {
  APPLICATION_CACHE_PREFIX,
  APPLICATION_SHELL_NAVIGATION_DENYLIST,
  SHELL_COMPATIBILITY_VERSION,
  readRetainedSnapshotCompatibility,
  shellCanActivate,
} from './app/local-data';

declare const self: ServiceWorkerGlobalScope;

setCacheNameDetails({
  prefix: APPLICATION_CACHE_PREFIX,
  suffix: `shell-v${SHELL_COMPATIBILITY_VERSION}`,
});
// Workbox replaces this injected manifest token during the production build.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: APPLICATION_SHELL_NAVIGATION_DENYLIST,
  }),
);

// Notes assets are cached only after Notes is actually opened, not during shell install.
registerRoute(
  ({ url }) =>
    url.origin === self.location.origin &&
    /^\/assets\/(?:NotesPage|notes-storage)-[\w-]+\.(?:js|css)$/.test(url.pathname),
  async ({ request }) => {
    const cache = await caches.open(`${APPLICATION_CACHE_PREFIX}-notes-assets-v1`);
    const retained = await cache.match(request);
    if (retained) return retained;
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      const keys = await cache.keys();
      await Promise.all(
        keys.slice(0, Math.max(0, keys.length - 30)).map((key) => cache.delete(key)),
      );
    }
    return response;
  },
);

const isExtendableEvent = (event: Event): event is ExtendableEvent => 'waitUntil' in event;

globalThis.addEventListener('install', (event) => {
  if (!isExtendableEvent(event)) return;
  event.waitUntil(
    readRetainedSnapshotCompatibility().then((compatibility) => {
      if (!shellCanActivate(compatibility)) {
        throw new Error('The retained Bookmark snapshot is incompatible with this shell.');
      }
      // Adopt compatible releases without waiting for every old tab to close.
      // Existing documents keep their drafts; their next navigation uses this shell.
      return self.skipWaiting();
    }),
  );
});
