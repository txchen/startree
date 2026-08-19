import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('CI uses the runner Chrome without installing Playwright browsers or system packages', () => {
  assert.doesNotMatch(workflow, /playwright install/);
  assert.match(workflow, /PLAYWRIGHT_CHROMIUM_CHANNEL:\s*chrome/);
});
