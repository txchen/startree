import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

// Model the previously deployed cache-first shell with a real installed worker.
// The current shell and worker below are the actual production build, not mocks.
const legacyHtml = `<!doctype html><html><body><h1>Legacy Bookmark page</h1>
<script>navigator.serviceWorker.register('/service-worker.js');</script></body></html>`;
const legacyWorker = `
self.addEventListener('install', event => {
  event.waitUntil(caches.open('startree-legacy-test').then(cache => cache.add('/index.html')));
});
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.open('startree-legacy-test').then(cache => cache.match('/index.html')));
  }
});`;

export const verifyShellUpgrade = async () => {
  let upgraded = false;
  const root = '00000000-0000-4000-8000-000000000000';
  const timestamp = '2026-09-21T00:00:00.000Z';
  const bookmark = {
    id: '20000000-0000-4000-8000-000000000001',
    folderId: root,
    url: 'https://example.com/',
    title: 'Upgrade fixture',
    note: '',
    rank: 'a',
    pinRank: null,
    createdAt: timestamp,
    modifiedAt: timestamp,
    version: 1,
  };
  const snapshot = {
    wireFormatVersion: 1,
    revision: 1,
    folders: [
      {
        id: root,
        name: '',
        parentId: null,
        rank: '0',
        createdAt: timestamp,
        modifiedAt: timestamp,
        version: 1,
      },
    ],
    bookmarks: [bookmark],
    tags: [],
    sequences: [{ folderId: root, folderVersion: 1, bookmarkVersion: 1 }],
  };
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/api/bookmarks/snapshot') {
      response.setHeader('Content-Type', 'application/json');
      if (request.headers['if-none-match'] === `"bookmarks-1-${snapshot.revision}"`) {
        response.writeHead(304);
        response.end();
      } else response.end(JSON.stringify(snapshot));
      return;
    }
    if (path === '/api/bookmarks/commands') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const command = JSON.parse(body);
      assert.equal(command.type, 'setBookmarkPin');
      bookmark.pinRank = command.pinned ? 'h' : null;
      snapshot.revision++;
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          status: 'acknowledged',
          operationId: command.operationId,
          revision: snapshot.revision,
          folders: [],
          bookmarks: [bookmark],
          tags: [],
          sequences: [],
        }),
      );
      return;
    }
    response.setHeader(
      'Content-Type',
      path.endsWith('.js')
        ? 'text/javascript'
        : path.endsWith('.css')
          ? 'text/css'
          : path.endsWith('.svg')
            ? 'image/svg+xml'
            : 'text/html',
    );
    if (!upgraded) {
      response.end(path === '/service-worker.js' ? legacyWorker : legacyHtml);
      return;
    }
    const asset =
      path.startsWith('/assets/') || ['/service-worker.js', '/brand-mark.svg'].includes(path)
        ? path
        : '/index.html';
    try {
      response.end(readFileSync(new URL(`../dist${asset}`, import.meta.url)));
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL,
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('https://example.com/**', (route) => route.abort());
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(url);
    await page.waitForFunction(async () =>
      Boolean((await navigator.serviceWorker.getRegistration())?.active),
    );
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    // Keep another old tab open, as is common for a browser start page.
    const olderTab = await page.context().newPage();
    await olderTab.goto(url);
    await olderTab.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    upgraded = true;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setBypassServiceWorker', { bypass: true });
    await page.reload();
    await page.locator('.bookmark-pin-button').click();
    await page.locator('[data-pin-id]').waitFor();
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration.update();
    });
    await page.waitForFunction(
      async () => !(await navigator.serviceWorker.getRegistration())?.installing,
    );
    await cdp.send('Network.setBypassServiceWorker', { bypass: false });
    await page.reload();
    await page.locator('.bookmark-pin-button').waitFor({ timeout: 5_000 });
    await page.locator('[data-pin-id]').waitFor({ timeout: 5_000 });
    assert.equal(
      await page.locator('[data-pin-id]').count(),
      1,
      'An upgraded browser lost its pinned Bookmark after normal reload.',
    );
    assert.equal(bookmark.pinRank, 'h');
    await olderTab.getByRole('heading', { name: 'Legacy Bookmark page' }).waitFor();
    console.log('Existing-browser shell upgrade and pin retention verification passed.');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) await verifyShellUpgrade();
