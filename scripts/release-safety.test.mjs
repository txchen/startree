import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertExpandContractMigrations,
  releaseSteps,
  releaseIdentity,
} from './release-safety.mjs';

test('production release checks compatibility before applying migrations and uses cf', () => {
  const steps = releaseSteps('production', 'abc1234');
  const compatibility = steps.findIndex(([_, args]) =>
    args.includes('scripts/verify-release-migrations.mjs'),
  );
  const apply = steps.findIndex(([_, args]) => args.includes('apply'));
  const deploy = steps.findIndex(
    ([_, args]) => args[0] === 'cf' && args[1] === 'deploy' && !args.includes('--dry-run'),
  );
  assert.ok(compatibility > 0 && compatibility < apply && apply < deploy);
  assert.ok(steps.some(([_, args]) => args.includes('--dry-run')));
  for (const [_, args] of steps.filter(([_, args]) => args[0] === 'cf')) {
    assert.equal(args[args.indexOf('--mode') + 1], 'production');
    assert.ok(!args.includes('wrangler'));
    if (args.includes('migrations'))
      assert.ok(args.includes('61de2cc1-4a03-4875-8bf8-306e7859350d'));
  }
  assert.ok(steps.at(-1)[1].includes('abc1234'));
  assert.throws(() => releaseSteps('local', 'abc1234'));
  assert.throws(() => releaseSteps(undefined, 'abc1234'));
  assert.throws(() => releaseSteps('production', ''));
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
