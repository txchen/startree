import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { buildPerformanceFixture } from './performance-fixture.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const db = new DatabaseSync(':memory:');
for (const path of [
  'migrations/0001_initial_bookmark_schema.sql',
  'migrations/0002_bookmark_commands.sql',
])
  db.exec(readFileSync(`${root}/${path}`, 'utf8'));
db.exec(buildPerformanceFixture('hierarchy').sql);
const snapshot = {
  wireFormatVersion: 1,
  revision: 1,
  folders: db
    .prepare(
      'SELECT id,name,parent_id AS parentId,rank,created_at AS createdAt,modified_at AS modifiedAt,version FROM bookmark_folders',
    )
    .all(),
  bookmarks: db
    .prepare(
      'SELECT id,folder_id AS folderId,url,title,note,rank,created_at AS createdAt,modified_at AS modifiedAt,version FROM bookmarks',
    )
    .all(),
  tags: db
    .prepare('SELECT bookmark_id AS bookmarkId,display_value AS value FROM bookmark_tags')
    .all(),
  sequences: db
    .prepare(
      "SELECT folder_id AS folderId,MAX(CASE WHEN kind='folders' THEN version END) AS folderVersion,MAX(CASE WHEN kind='bookmarks' THEN version END) AS bookmarkVersion FROM bookmark_sequences GROUP BY folder_id",
    )
    .all(),
};
const body = JSON.stringify(snapshot);
const server = createServer((req, res) => {
  if (req.url === '/api/bookmarks/snapshot') {
    res.setHeader('Cache-Control', 'no-store');
    if (req.headers['if-none-match']) {
      res.writeHead(304);
      res.end();
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end(body);
    }
    return;
  }
  const path =
    req.url.startsWith('/assets/') ||
    req.url === '/service-worker.js' ||
    req.url === '/brand-mark.svg'
      ? req.url
      : '/index.html';
  try {
    res.setHeader(
      'Content-Type',
      path.endsWith('.js')
        ? 'text/javascript'
        : path.endsWith('.css')
          ? 'text/css'
          : path.endsWith('.svg')
            ? 'image/svg+xml'
            : 'text/html',
    );
    res.end(readFileSync(`${root}/dist${path}`));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const slowIndex of [false, true]) {
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const page = await context.newPage();
      await page.addInitScript(
        ({ slowIndex }) => {
          const BaseWorker = window.Worker;
          window.Worker = class extends BaseWorker {
            postMessage(message, ...args) {
              if (slowIndex && message.type === 'replace')
                setTimeout(() => super.postMessage(message, ...args), 1000);
              else super.postMessage(message, ...args);
            }
          };
          const observer = new MutationObserver(() => {
            if (!window.browsable && document.querySelector('.folder-tile'))
              window.browsable = performance.now();
          });
          observer.observe(document, { childList: true, subtree: true });
        },
        { slowIndex },
      );
      await page.goto(url);
      await page.locator('.folder-tile').first().waitFor();
      const cold = await page.evaluate(() => window.browsable);
      await page.locator('#bookmark-search-input').fill('Performance Bookmark 10');
      await page.locator('.search-results').waitFor();
      await page.reload();
      await page.locator('.folder-tile').first().waitFor();
      samples.push({ cold, warm: await page.evaluate(() => window.browsable) });
      await context.close();
    }
    const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
    console.log(
      JSON.stringify(
        {
          fixtureCase: 'hierarchy',
          bookmarks: snapshot.bookmarks.length,
          folders: snapshot.folders.length - 1,
          indexDelayMs: slowIndex ? 1000 : 0,
          medianColdBrowseMs: median(samples.map((sample) => sample.cold)),
          medianWarmBrowseMs: median(samples.map((sample) => sample.warm)),
          samples,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await browser?.close();
  server.close();
  db.close();
}
