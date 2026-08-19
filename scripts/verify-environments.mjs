import { readFileSync } from 'node:fs';
import { parse } from 'jsonc-parser';

const config = parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const preview = config.env.preview;
const production = config.env.production;
const local = config.env.local;

const databaseName = (environment) =>
  environment.d1_databases.find(({ binding }) => binding === 'DB')?.database_name;
const identities = [local, preview, production].map((environment) => ({
  database: databaseName(environment),
  worker: environment.name,
}));

const configurationFailure = (check, message) => {
  console.error(JSON.stringify({ event: 'configuration_failure', check }));
  throw new Error(message);
};

if (new Set(identities.map(({ worker }) => worker)).size !== identities.length) {
  configurationFailure(
    'worker_environment_isolation',
    'Local, preview, and production Worker names must be distinct.',
  );
}

if (preview.name !== 'startree-preview' || production.name !== 'startree') {
  configurationFailure(
    'worker_names',
    'Preview must use startree-preview and production must use startree.',
  );
}

if (new Set(identities.map(({ database }) => database)).size !== identities.length) {
  configurationFailure(
    'database_environment_isolation',
    'Local, preview, and production D1 database names must be distinct.',
  );
}

if (preview.workers_dev !== true || preview.preview_urls !== false) {
  configurationFailure('preview_surfaces', 'Preview must use only its fixed workers.dev hostname.');
}

const productionRoute = production.routes?.find(({ pattern }) => pattern === 'startree.txchen.win');
if (
  production.workers_dev !== false ||
  production.preview_urls !== false ||
  productionRoute?.custom_domain !== true
) {
  configurationFailure(
    'production_surfaces',
    'Production must serve only the startree.txchen.win custom domain.',
  );
}

for (const [name, environment] of Object.entries({ local, preview, production })) {
  const rateLimit = environment.ratelimits?.find(
    ({ name: binding }) => binding === 'MUTATION_RATE_LIMITER',
  );
  if (rateLimit?.simple?.limit !== 120 || rateLimit.simple.period !== 60) {
    configurationFailure(
      'mutation_rate_limit',
      `${name} must limit Bookmark mutations to 120 requests per minute.`,
    );
  }
}

console.log('Environment isolation verified:', identities);
