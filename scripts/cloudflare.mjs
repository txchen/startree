import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvironment } from '../cloudflare.environments.ts';
import { run } from './process.mjs';

export const cfArgs = (
  args,
  mode,
  { profile = process.env.CF_PROFILE, locationArgs = [] } = {},
) => {
  getEnvironment(mode);
  if ((mode === 'local') !== locationArgs.includes('--local'))
    throw new Error('Local mode requires local D1; remote modes must not use local storage.');
  return [
    'cf',
    ...args,
    '--mode',
    mode,
    ...locationArgs.filter((arg) => arg !== '--remote'),
    ...(profile ? ['--profile', profile] : []),
  ];
};
const runD1 = (args, mode, options, processOptions = {}) => {
  const commandArgs = cfArgs(args, mode, options);
  return mode === 'local'
    ? run(process.execPath, ['scripts/cf-local.mjs', ...commandArgs.slice(1)], processOptions)
    : run('npx', commandArgs, processOptions);
};
export const d1Migrations = (operation, mode, options = {}) =>
  runD1(
    ['d1', 'migrations', operation, getEnvironment(mode).databaseId, '--dir', './migrations'],
    mode,
    options,
  );
export const d1Query = (sql, mode, options = {}) => {
  const directory = mkdtempSync(join(tmpdir(), 'startree-d1-query-'));
  try {
    const body = join(directory, 'query.json');
    writeFileSync(
      body,
      JSON.stringify(
        Array.isArray(sql) ? { batch: sql.map((statement) => ({ sql: statement })) } : { sql },
      ),
      { mode: 0o600 },
    );
    const local = options.locationArgs?.includes('--local');
    const output = runD1(
      ['d1', local ? 'raw' : 'query', getEnvironment(mode).databaseId, '--body', `@${body}`],
      mode,
      options,
      { capture: true },
    );
    const results = JSON.parse(output);
    if (!Array.isArray(results) || results.some((result) => !result.success))
      throw new Error('D1 query failed.');
    return local
      ? results.map((result) => ({
          ...result,
          results: result.results.rows.map((row) =>
            Object.fromEntries(result.results.columns.map((column, index) => [column, row[index]])),
          ),
        }))
      : results;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};
