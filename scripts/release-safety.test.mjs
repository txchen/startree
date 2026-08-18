import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertExpandContractMigrations,
  releaseSteps,
  releaseIdentity,
} from './release-safety.mjs';

test('production release checks compatibility before applying remote migrations', () => {
  assert.deepEqual(releaseSteps('production', 'abc123'), [
    ['npx', ['vp', 'run', 'verify']],
    ['npx', ['wrangler', 'd1', 'migrations', 'list', 'DB', '--remote', '--env', 'production']],
    ['node', ['scripts/verify-release-migrations.mjs']],
    ['npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--remote', '--env', 'production']],
    [
      'npx',
      ['wrangler', 'deploy', '--strict', '--env', 'production', '--var', 'APP_VERSION:abc123'],
    ],
  ]);
});

test('migration compatibility requires an explicit expand-contract declaration', () => {
  assert.doesNotThrow(() =>
    assertExpandContractMigrations([
      {
        name: '0003_add_column.sql',
        sql: '-- startree: expand-contract-compatible\nALTER TABLE x;',
      },
    ]),
  );
  assert.throws(
    () => assertExpandContractMigrations([{ name: '0003_drop_column.sql', sql: 'ALTER TABLE x;' }]),
    /0003_drop_column\.sql/,
  );
  assert.throws(
    () =>
      assertExpandContractMigrations([
        {
          name: '0003_destructive.sql',
          sql: '-- startree: expand-contract-compatible\nALTER TABLE bookmarks DROP COLUMN note;',
        },
      ]),
    /destructive SQL/i,
  );
});

test('release status identifies the deployed Worker version and target', () => {
  assert.deepEqual(
    releaseIdentity('production', {
      deployments: [{ versions: [{ version_id: 'version-123', percentage: 100 }] }],
    }),
    { target: 'https://startree.txchen.win', versionId: 'version-123' },
  );
});
