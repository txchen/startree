import assert from 'node:assert/strict';
import test from 'node:test';
import { cfArgs } from './cloudflare.mjs';

test('database commands cannot accidentally target remote storage in local mode', () => {
  assert.throws(() => cfArgs(['d1', 'query'], 'local'), /Local mode/);
  assert.throws(
    () => cfArgs(['d1', 'query'], 'production', { locationArgs: ['--local'] }),
    /Local mode/,
  );
  assert.throws(() => cfArgs(['d1', 'query'], 'staging'), /explicit Cloudflare mode/);
  assert.ok(cfArgs(['d1', 'query'], 'local', { locationArgs: ['--local'] }).includes('--local'));
});
