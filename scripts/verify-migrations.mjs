import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { d1Migrations, d1Query } from './cloudflare.mjs';
const persistenceDirectory = mkdtempSync(join(tmpdir(), 'startree-migrations-'));
const options = { locationArgs: ['--local', '--persist-to', persistenceDirectory] };
d1Migrations('apply', 'local', options);
const results = d1Query(
  "SELECT revision FROM bookmark_domain_state WHERE name = 'bookmarks'",
  'local',
  options,
);
if (results[0]?.results?.[0]?.revision !== 0)
  throw new Error('The migrated database does not contain the initial Bookmark revision.');
console.log('All migrations applied successfully to a new local D1 database.');
