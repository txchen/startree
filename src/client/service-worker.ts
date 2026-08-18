/// <reference lib="webworker" />

import { setCacheNameDetails } from 'workbox-core';
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

setCacheNameDetails({
  prefix: APPLICATION_CACHE_PREFIX,
  suffix: `shell-v${SHELL_COMPATIBILITY_VERSION}`,
});
// @ts-expect-error Workbox replaces this injected manifest token during the production build.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: APPLICATION_SHELL_NAVIGATION_DENYLIST,
  }),
);

const isExtendableEvent = (event: Event): event is ExtendableEvent => 'waitUntil' in event;

globalThis.addEventListener('install', (event) => {
  if (!isExtendableEvent(event)) return;
  event.waitUntil(
    readRetainedSnapshotCompatibility().then((compatibility) => {
      if (!shellCanActivate(compatibility)) {
        throw new Error('The retained Bookmark snapshot is incompatible with this shell.');
      }
    }),
  );
});
