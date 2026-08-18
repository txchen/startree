import { run } from './process.mjs';

const environment = process.argv[2];
if (environment !== 'preview' && environment !== 'production') {
  throw new Error('Choose exactly one deployment environment: preview or production.');
}

const revision = run('git', ['rev-parse', 'HEAD'], { capture: true });
const wranglerProfile = process.env.WRANGLER_PROFILE?.trim();
const wrangler = (...args) => [
  'wrangler',
  ...args,
  ...(wranglerProfile ? ['--profile', wranglerProfile] : []),
];

if (environment === 'production') {
  run('git', ['diff', '--quiet']);
  run('git', ['diff', '--cached', '--quiet']);

  const untracked = run('git', ['ls-files', '--others', '--exclude-standard'], { capture: true });
  if (untracked) {
    throw new Error('Production deployment requires a clean working tree.');
  }

  run('git', ['fetch', 'origin', 'master']);
  run('git', ['merge-base', '--is-ancestor', revision, 'origin/master']);
}

run('npx', ['vp', 'run', 'check']);
run('npx', ['vp', 'run', 'test']);
run('npx', ['vp', 'run', 'build']);
run('npx', wrangler('d1', 'migrations', 'list', 'DB', '--remote', '--env', environment));
run('npx', wrangler('d1', 'migrations', 'apply', 'DB', '--remote', '--env', environment));
run('npx', wrangler('deploy', '--env', environment, '--var', `APP_VERSION:${revision}`));

const target =
  environment === 'production'
    ? 'https://startree.txchen.win'
    : 'the fixed startree-preview workers.dev URL';
console.log(`Deployment completed for ${target} at Git revision ${revision}.`);
