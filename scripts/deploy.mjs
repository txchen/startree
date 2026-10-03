import { getEnvironment } from '../cloudflare.environments.ts';
import { run } from './process.mjs';
import { releaseIdentity, releaseSteps } from './release-safety.mjs';

const environment = process.argv[2];
if (environment !== 'preview' && environment !== 'production') {
  throw new Error('Choose exactly one deployment environment: preview or production.');
}

const revision = run('git', ['rev-parse', 'HEAD'], { capture: true });
const profile = process.env.CF_PROFILE?.trim();
const profileArgs = profile ? ['--profile', profile] : [];
process.env.STARTREE_RELEASE_REVISION = revision;

if (environment === 'production') {
  const workingTree = run('git', ['status', '--porcelain'], { capture: true });
  if (workingTree) {
    throw new Error('Production deployment requires a clean working tree.');
  }

  run('git', ['fetch', 'origin', 'master']);
  run('git', ['merge-base', '--is-ancestor', revision, 'origin/master']);
}

for (const [command, args] of releaseSteps(environment, revision)) {
  run(command, args[0] === 'cf' ? [...args, ...profileArgs] : args);
}

const deployment = JSON.parse(
  run(
    'npx',
    [
      'cf',
      'workers',
      'deployments',
      'list',
      '--worker',
      getEnvironment(environment).name,
      '--mode',
      environment,
      ...profileArgs,
    ],
    { capture: true },
  ),
);
const { target, versionId } = releaseIdentity(environment, deployment);

console.log(
  `Deployment completed for ${target} at Git revision ${revision}; Worker version ${versionId}.`,
);
