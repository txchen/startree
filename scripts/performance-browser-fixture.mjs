import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { buildPerformanceFixture } from './performance-fixture.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

export const startPerformanceBrowserFixture = async (fixtureCase = 'hierarchy') => {
  const db = new DatabaseSync(':memory:');
  for (const path of [
    'migrations/0001_initial_bookmark_schema.sql',
    'migrations/0002_bookmark_commands.sql',
  ])
    db.exec(readFileSync(`${root}/${path}`, 'utf8'));
  const fixture = buildPerformanceFixture(fixtureCase);
  db.exec(fixture.sql);
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
  db.close();
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
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    manifest: fixture.manifest,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
};
