import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const localWorkerAcceptance = readFileSync(
  new URL('./verify-local-worker.mjs', import.meta.url),
  'utf8',
);

test('CI uses the runner Chrome without installing Playwright browsers or system packages', () => {
  assert.doesNotMatch(workflow, /playwright install/);
  assert.match(workflow, /PLAYWRIGHT_CHROMIUM_CHANNEL:\s*chrome/);
});

test('CI does not enforce performance targets from a single browser timing sample', () => {
  assert.doesNotMatch(localWorkerAcceptance, /Local mutation timing exceeded its target/);
});
