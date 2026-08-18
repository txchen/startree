import { readdirSync, readFileSync } from 'node:fs';

import { assertExpandContractMigrations } from './release-safety.mjs';

const migrations = readdirSync(new URL('../migrations', import.meta.url))
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({
    name,
    sql: readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'),
  }));

assertExpandContractMigrations(migrations);
console.log('All release migrations declare expand/contract compatibility.');
