import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { run } from './process.mjs';

const persistenceDirectory = mkdtempSync(join(tmpdir(), 'startree-worker-'));
const port = '8788';

run('npx', [
  'wrangler',
  'd1',
  'migrations',
  'apply',
  'DB',
  '--local',
  '--env',
  'local',
  '--persist-to',
  persistenceDirectory,
]);

run('npx', [
  'wrangler',
  'd1',
  'execute',
  'DB',
  '--local',
  '--env',
  'local',
  '--persist-to',
  persistenceDirectory,
  '--file',
  'tests/fixtures/read-only-bookmarks.sql',
]);

const worker = spawn(
  fileURLToPath(new URL('../node_modules/.bin/wrangler', import.meta.url)),
  ['dev', '--env', 'local', '--local', '--port', port, '--persist-to', persistenceDirectory],
  {
    cwd: new URL('..', import.meta.url),
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let diagnostics = '';
worker.stdout.on('data', (chunk) => (diagnostics += chunk.toString()));
worker.stderr.on('data', (chunk) => (diagnostics += chunk.toString()));

try {
  let apiResponse;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      apiResponse = await fetch(`http://127.0.0.1:${port}/api/v1/platform`);
      break;
    } catch {
      await delay(250);
    }
  }

  if (!apiResponse?.ok) {
    throw new Error(`Local Worker API did not start.\n${diagnostics}`);
  }

  const payload = await apiResponse.json();
  if (payload.application !== 'startree' || payload.bookmarkRevision !== 1) {
    throw new Error(`Unexpected local API response: ${JSON.stringify(payload)}`);
  }

  const snapshotResponse = await fetch(`http://127.0.0.1:${port}/api/bookmarks/snapshot`);
  const snapshot = await snapshotResponse.json();
  if (
    !snapshotResponse.ok ||
    snapshotResponse.headers.get('etag') !== '"bookmarks-1-1"' ||
    snapshotResponse.headers.get('cache-control') !== 'private, no-store' ||
    snapshot.folders.length !== 4 ||
    snapshot.bookmarks.length !== 1 ||
    snapshot.tags.length !== 2
  ) {
    throw new Error(`Unexpected Bookmark snapshot response: ${JSON.stringify(snapshot)}`);
  }

  const conditionalResponse = await fetch(`http://127.0.0.1:${port}/api/bookmarks/snapshot`, {
    headers: { 'If-None-Match': '"bookmarks-1-1"' },
  });
  if (conditionalResponse.status !== 304) {
    throw new Error(`Conditional Bookmark snapshot returned ${conditionalResponse.status}.`);
  }

  const clientResponse = await fetch(`http://127.0.0.1:${port}/bookmarks/foundation`);
  const clientHtml = await clientResponse.text();
  if (!clientResponse.ok || !clientHtml.includes('<div id="app"></div>')) {
    throw new Error(
      'The local Worker did not serve the client application for an HTML5 history route.',
    );
  }
  if (!clientResponse.headers.get('content-security-policy')?.includes("default-src 'self'")) {
    throw new Error('The local Worker did not apply baseline security headers to client assets.');
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://127.0.0.1:${port}/bookmarks`);
    await page.getByRole('heading', { level: 1, name: 'Bookmarks' }).waitFor();
    await page.locator('.folder-grid button').filter({ hasText: 'Reading' }).click();
    await page.waitForURL(`**/bookmarks/10000000-0000-4000-8000-000000000001`);
    await page.getByRole('heading', { level: 1, name: 'Reading' }).waitFor();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();

    await page.getByRole('button', { name: 'New Folder' }).click();
    const folderNameInput = page.getByLabel('Folder name');
    await folderNameInput.fill('Draft Folder');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByText('Discard your unsaved changes?').waitFor();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    if (!(await folderNameInput.isVisible())) {
      throw new Error('Dirty-form protection dismissed the Folder editor unexpectedly.');
    }
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();

    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.getByLabel('Folder name').fill('UI Folder');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.locator('.folder-grid').getByText('UI Folder', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Edit UI Folder' }).click();
    await page.getByLabel('Folder name').fill('UI Folder Renamed');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.locator('.folder-grid').getByText('UI Folder Renamed', { exact: true }).waitFor();

    await page.getByRole('button', { name: 'New Bookmark' }).click();
    await page.getByLabel('URL').fill('https://example.org/ui');
    await page.getByLabel('Title').fill('UI Bookmark');
    await page.getByLabel(/Tags/).fill(' Beta, alpha, beta ');
    await page.getByLabel('Note').fill('Created through the complete Worker.');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.getByRole('link', { name: /UI Bookmark/ }).waitFor();
    await page
      .locator('.bookmark-card-shell', { hasText: 'UI Bookmark' })
      .locator('.bookmark-edit-button')
      .click();
    await page.getByLabel('Title').fill('UI Bookmark Edited');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.getByRole('link', { name: /UI Bookmark Edited/ }).waitFor();

    await page.route('**/api/bookmarks/commands', async (route) => {
      await delay(1_200);
      await route.continue();
    });
    await page
      .locator('.bookmark-card-shell', { hasText: 'UI Bookmark Edited' })
      .locator('.bookmark-edit-button')
      .click();
    await page.getByLabel('Note').fill('A deliberately slow update.');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByText('Still saving changes…').waitFor({ timeout: 2_000 });
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.unrouteAll({ behavior: 'wait' });

    await page.route('**/api/bookmarks/commands', (route) =>
      route.fulfill({ status: 400, contentType: 'application/json', body: '{}' }),
    );
    await page
      .locator('.bookmark-card-shell', { hasText: 'UI Bookmark Edited' })
      .locator('.bookmark-edit-button')
      .click();
    await page.getByLabel('Note').fill('This update must fail.');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByText('The change was not saved.').waitFor();
    if (!(await page.getByRole('dialog').isVisible())) {
      throw new Error('A failed save dismissed the Bookmark editor.');
    }
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();
    await page.unrouteAll({ behavior: 'wait' });

    await page.route('**/api/bookmarks/commands', (route) => route.abort('connectionfailed'));
    await page
      .locator('.bookmark-card-shell', { hasText: 'UI Bookmark Edited' })
      .locator('.bookmark-edit-button')
      .click();
    await page.getByLabel('Note').fill('This update has an unknown result.');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByText(/save result is unknown/i).waitFor();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();
    await page.unrouteAll({ behavior: 'wait' });
    await page.getByRole('button', { name: 'Retry same operation' }).click();
    await page.getByText('The save result is unknown.').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Done' }).click();
    if (await page.getByRole('button', { name: 'New Folder' }).count()) {
      throw new Error('Done did not return the desktop Bookmarks Page to Browse Mode.');
    }

    const bookmarkAnchor = page.getByRole('link', { name: /Example Reference/ });
    if ((await bookmarkAnchor.getAttribute('href')) !== 'https://example.com/reference') {
      throw new Error('The Bookmark card is not a native destination anchor.');
    }
    await page.getByText('A useful reference for complete-Worker verification.').waitFor();
    await page.getByText('Café').waitFor();

    const searchInput = page.locator('#bookmark-search-input');
    await page.locator('body').press('/');
    if (!(await searchInput.evaluate((element) => element === document.activeElement))) {
      throw new Error('The slash shortcut did not focus global Bookmark search.');
    }
    await searchInput.fill('Café');
    const searchBookmark = page
      .locator('.search-results a')
      .filter({ hasText: 'Example Reference' });
    await searchBookmark.waitFor();
    if ((await searchBookmark.getAttribute('href')) !== 'https://example.com/reference') {
      throw new Error('A Bookmark search result is not a native destination anchor.');
    }
    await searchBookmark.getByText('Bookmarks / Reading').waitFor();
    await searchInput.press('Escape');
    if (await page.locator('.search-results').count()) {
      throw new Error('Escape did not close global Bookmark search.');
    }

    await searchInput.fill('');
    await searchInput.press('/');
    if ((await searchInput.inputValue()) !== '/') {
      throw new Error('The global slash shortcut stole input from a form control.');
    }
    await searchInput.press('Escape');
    await searchInput.blur();
    await page.locator('body').press('Control+k');
    if (!(await searchInput.evaluate((element) => element === document.activeElement))) {
      throw new Error('The Control+K shortcut did not focus global Bookmark search.');
    }
    await searchInput.fill('Reading');
    await page.locator('.search-results button').filter({ hasText: 'Reading' }).waitFor();
    await searchInput.press('ArrowDown');
    await searchInput.press('Enter');
    await page.waitForURL(`**/bookmarks/10000000-0000-4000-8000-000000000001`);

    await page.goBack();
    await page.waitForURL(`**/bookmarks`);
    await page.getByRole('heading', { level: 1, name: 'Bookmarks' }).waitFor();
    await page.goForward();
    await page.getByRole('heading', { level: 1, name: 'Reading' }).waitFor();
    await page.reload();
    await page.getByRole('heading', { level: 1, name: 'Reading' }).waitFor();

    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

    const localStorageAudit = await page.evaluate(async () => {
      const cacheNames = await caches.keys();
      const cachedUrls = [];
      let containsBookmarkData = false;
      for (const cacheName of cacheNames) {
        const cache = await caches.open(cacheName);
        for (const request of await cache.keys()) {
          cachedUrls.push(request.url);
          const response = await cache.match(request);
          const text = await response?.clone().text();
          if (text?.includes('Example Reference') || text?.includes('example.com/reference')) {
            containsBookmarkData = true;
          }
        }
      }
      return {
        cacheNames,
        cachedUrls,
        containsBookmarkData,
        localStorageKeys: Object.keys(localStorage),
        sessionStorageKeys: Object.keys(sessionStorage),
      };
    });
    if (
      !localStorageAudit.cacheNames.some((name) => name.startsWith('startree-precache-')) ||
      localStorageAudit.cachedUrls.some((url) => url.includes('/api/')) ||
      localStorageAudit.containsBookmarkData ||
      localStorageAudit.localStorageKeys.length ||
      localStorageAudit.sessionStorageKeys.length
    ) {
      throw new Error(
        `Structured Bookmark data escaped IndexedDB: ${JSON.stringify(localStorageAudit)}`,
      );
    }

    await page.context().setOffline(true);
    await page.reload();
    await page.getByRole('heading', { level: 1, name: 'Reading' }).waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    const offlineStatus = page.locator('.sync-status');
    await offlineStatus.waitFor();
    const offlineText = await offlineStatus.textContent();
    if (!offlineText?.includes('Offline — showing retained Bookmarks')) {
      throw new Error(`Offline state was not exposed: ${offlineText}`);
    }
    await page.getByText(/Last synchronized:/).waitFor();
    await searchInput.fill('useful reference');
    await page.locator('.search-results a').filter({ hasText: 'Example Reference' }).waitFor();
    await page.getByText('A useful reference for complete-Worker verification.').waitFor();
    await page.getByText('Café').waitFor();

    await page.route('**/api/bookmarks/snapshot', async (route) => {
      await delay(6_000);
      await route.continue();
    });
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.locator('.sync-status.syncing').waitFor({ timeout: 4_000 });
    await page.locator('.sync-status.slow').waitFor({ timeout: 7_000 });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.getByRole('button', { name: 'Retry' }).click();
    await page.locator('.sync-status').waitFor({ state: 'detached' });

    await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase('startree-bookmarks');
          request.addEventListener('success', () => resolve(undefined), { once: true });
          request.addEventListener('error', () => reject(request.error), { once: true });
        }),
    );
    await page.context().setOffline(true);
    await page.reload();
    await page
      .getByRole('heading', { level: 1, name: 'The library could not be loaded' })
      .waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.locator('.sync-status.offline').waitFor();
    const emptyOfflineText = await page.locator('.library-state p').textContent();
    const emptyOfflineStatus = await page.locator('.sync-status.offline').textContent();
    if (!emptyOfflineText?.includes('Go online once to retain this private library')) {
      throw new Error(`Offline-without-snapshot guidance was not exposed: ${emptyOfflineText}`);
    }
    if (
      !emptyOfflineStatus?.includes('an online load is required') ||
      emptyOfflineStatus.includes('showing retained Bookmarks')
    ) {
      throw new Error(`Offline-without-snapshot status was contradictory: ${emptyOfflineStatus}`);
    }
    await page.context().setOffline(false);
    await page.reload();
    await page.getByRole('heading', { level: 1, name: 'Reading' }).waitFor();

    await page.evaluate(() => history.pushState({}, '', '/bookmarks/missing-folder'));
    await page.goBack();
    await page.getByRole('heading', { level: 1, name: 'Reading' }).waitFor();
    await page.goForward();
    await page.getByRole('heading', { level: 1, name: 'Folder not found' }).waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`http://127.0.0.1:${port}/bookmarks`);
    await page.getByRole('button', { name: 'Folders' }).click();
    await page.locator('.folder-drawer .tree-folder').filter({ hasText: 'Reading' }).click();
    await page.getByRole('heading', { level: 1, name: 'Reading' }).waitFor();
    if (await page.locator('.folder-drawer').isVisible()) {
      throw new Error('The mobile Folder drawer remained open after selection.');
    }
    if (await page.getByRole('button', { name: /Edit|Save|Delete|Move|Reorder/ }).count()) {
      throw new Error('The mobile read-only experience exposed editing controls.');
    }
  } finally {
    await browser.close();
  }

  console.log(
    'Local Worker passed D1-backed API, search, keyboard, offline, and refresh-degradation verification.',
  );
} finally {
  worker.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => worker.once('exit', resolve)), delay(2_000)]);
}
