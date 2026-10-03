import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadAndVerifyPerformanceFixture } from './performance-fixture-d1.mjs';
import { d1Migrations } from './cloudflare.mjs';

const persistenceDirectory = mkdtempSync(join(tmpdir(), 'startree-performance-'));
d1Migrations('apply', 'local', { locationArgs: ['--local', '--persist-to', persistenceDirectory] });

for (const fixtureCase of ['hierarchy', 'concentration', 'maximum-fields']) {
  const manifest = loadAndVerifyPerformanceFixture({
    fixtureCase,
    directory: persistenceDirectory,
    environment: 'local',
    locationArgs: ['--local', '--persist-to', persistenceDirectory],
  });
  console.log('Verified performance fixture:', manifest);
}
