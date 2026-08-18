import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { run } from './process.mjs';

const persistenceDirectory = mkdtempSync(join(tmpdir(), 'startree-migrations-'));

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

const output = run(
  'npx',
  [
    'wrangler',
    'd1',
    'execute',
    'DB',
    '--local',
    '--env',
    'local',
    '--persist-to',
    persistenceDirectory,
    '--command',
    "SELECT revision FROM bookmark_domain_state WHERE name = 'bookmarks'",
    '--json',
  ],
  { capture: true },
);

const results = JSON.parse(output);
if (results[0]?.results?.[0]?.revision !== 0) {
  throw new Error('The migrated database does not contain the initial Bookmark revision.');
}

console.log('All migrations applied successfully to a new local D1 database.');
