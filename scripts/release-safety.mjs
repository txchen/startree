import { getEnvironment } from '../cloudflare.environments.ts';

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

export const releaseSteps = (environment, revision) => {
  if (environment !== 'preview' && environment !== 'production')
    throw new Error('Deployments require preview or production mode.');
  if (!/^[a-f0-9]{7,40}$/.test(revision)) throw new Error('A Git revision is required.');
  const databaseId = getEnvironment(environment).databaseId;
  return [
    ['npx', ['vp', 'run', 'verify']],
    ['npx', ['cf', 'deploy', '--dry-run', '--mode', environment]],
    [
      'npx',
      [
        'cf',
        'd1',
        'migrations',
        'list',
        databaseId,
        '--dir',
        './migrations',
        '--mode',
        environment,
      ],
    ],
    ['node', ['scripts/verify-release-migrations.mjs']],
    [
      'npx',
      [
        'cf',
        'd1',
        'migrations',
        'apply',
        databaseId,
        '--dir',
        './migrations',
        '--mode',
        environment,
      ],
    ],
    ['npx', ['cf', 'deploy', '--mode', environment, '--tag', revision]],
  ];
};

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
