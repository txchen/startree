import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadAndVerifyPerformanceFixture } from './performance-fixture-d1.mjs';
import { run } from './process.mjs';

const persistenceDirectory = mkdtempSync(join(tmpdir(), 'startree-performance-'));
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

for (const fixtureCase of ['hierarchy', 'concentration', 'maximum-fields']) {
  const manifest = loadAndVerifyPerformanceFixture({
    fixtureCase,
    directory: persistenceDirectory,
    environment: 'local',
    locationArgs: ['--local', '--persist-to', persistenceDirectory],
  });
  console.log('Verified performance fixture:', manifest);
}
