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

    const bookmarkAnchor = page.getByRole('link', { name: /Example Reference/ });
    if ((await bookmarkAnchor.getAttribute('href')) !== 'https://example.com/reference') {
      throw new Error('The Bookmark card is not a native destination anchor.');
    }
    await page.getByText('A useful reference for complete-Worker verification.').waitFor();
    await page.getByText('阅读').waitFor();

    await page.reload();
    await page.getByRole('heading', { level: 1, name: 'Reading' }).waitFor();
    await page.goBack();
    await page.waitForURL(`**/bookmarks`);
    await page.getByRole('heading', { level: 1, name: 'Bookmarks' }).waitFor();
    await page.goForward();
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

  console.log('Local Worker passed D1-backed API and browser navigation verification.');
} finally {
  worker.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => worker.once('exit', resolve)), delay(2_000)]);
}
