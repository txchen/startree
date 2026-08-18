const COMPATIBILITY_DECLARATION = '-- startree: expand-contract-compatible';

export const assertExpandContractMigrations = (migrations) => {
  const unsafe = migrations.filter(({ sql }) => !sql.startsWith(COMPATIBILITY_DECLARATION));
  if (unsafe.length) {
    throw new Error(
      `Release blocked: migrations lack the expand/contract compatibility declaration: ${unsafe
        .map(({ name }) => name)
        .join(', ')}`,
    );
  }

  const destructivePattern =
    /\b(?:DROP\s+(?:TABLE|COLUMN|INDEX|VIEW|TRIGGER)|ALTER\s+TABLE\b[^;]*\b(?:RENAME|DROP)\b|DELETE\s+FROM|REPLACE\s+INTO|VACUUM)\b/i;
  const destructive = migrations.filter(({ sql }) =>
    destructivePattern.test(
      sql
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n'),
    ),
  );
  if (destructive.length) {
    throw new Error(
      `Release blocked: expand/contract migrations contain destructive SQL: ${destructive
        .map(({ name }) => name)
        .join(', ')}`,
    );
  }
};

export const releaseSteps = (environment, revision) => [
  ['npx', ['vp', 'run', 'verify']],
  ['npx', ['wrangler', 'd1', 'migrations', 'list', 'DB', '--remote', '--env', environment]],
  ['node', ['scripts/verify-release-migrations.mjs']],
  ['npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--remote', '--env', environment]],
  [
    'npx',
    ['wrangler', 'deploy', '--strict', '--env', environment, '--var', `APP_VERSION:${revision}`],
  ],
];

export const releaseIdentity = (environment, deployment) => {
  const current = deployment.deployments?.[0] ?? deployment;
  const active = current.versions?.find(({ percentage }) => percentage === 100);
  if (!active?.version_id) {
    throw new Error('The active Worker version ID was not present in deployment status.');
  }
  return {
    target:
      environment === 'production'
        ? 'https://startree.txchen.win'
        : 'the fixed startree-preview workers.dev URL',
    versionId: active.version_id,
  };
};
