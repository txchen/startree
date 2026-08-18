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

if (new Set(identities.map(({ worker }) => worker)).size !== identities.length) {
  throw new Error('Local, preview, and production Worker names must be distinct.');
}

if (new Set(identities.map(({ database }) => database)).size !== identities.length) {
  throw new Error('Local, preview, and production D1 database names must be distinct.');
}

if (preview.workers_dev !== true || preview.preview_urls !== false) {
  throw new Error('Preview must use only its fixed workers.dev hostname.');
}

const productionRoute = production.routes?.find(({ pattern }) => pattern === 'startree.txchen.win');
if (
  production.workers_dev !== false ||
  production.preview_urls !== false ||
  productionRoute?.custom_domain !== true
) {
  throw new Error('Production must serve only the startree.txchen.win custom domain.');
}

console.log('Environment isolation verified:', identities);
