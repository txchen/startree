import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadAndVerifyPerformanceFixture } from './performance-fixture-d1.mjs';
import { run } from './process.mjs';

const fixtureCase = process.argv[2];
if (!['hierarchy', 'concentration', 'maximum-fields'].includes(fixtureCase)) {
  throw new Error('Choose hierarchy, concentration, or maximum-fields.');
}
if (process.env.STARTREE_CONFIRM_PREVIEW_RESET !== 'synthetic-preview-only') {
  throw new Error(
    'Set STARTREE_CONFIRM_PREVIEW_RESET=synthetic-preview-only to acknowledge replacement of preview synthetic data.',
  );
}

const profile = process.env.WRANGLER_PROFILE?.trim();
const wrangler = (...args) => ['wrangler', ...args, ...(profile ? ['--profile', profile] : [])];
const directory = mkdtempSync(join(tmpdir(), 'startree-preview-performance-'));

run('npx', wrangler('d1', 'migrations', 'apply', 'DB', '--remote', '--env', 'preview'));
const manifest = loadAndVerifyPerformanceFixture({
  fixtureCase,
  directory,
  environment: 'preview',
  locationArgs: ['--remote'],
  profile,
});
console.log('Prepared preview performance fixture:', manifest);
