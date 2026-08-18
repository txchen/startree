import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { run } from './process.mjs';

const persistenceDirectory = mkdtempSync(join(tmpdir(), 'startree-worker-'));
const port = '8788';

run('npx', [
  'wrangler',
  'd1',
  'migrations',
  'apply',
  'DB',
  '--local',
  '--env',
  'local',
  '--persist-to',
  persistenceDirectory,
]);

const worker = spawn(
  fileURLToPath(new URL('../node_modules/.bin/wrangler', import.meta.url)),
  ['dev', '--env', 'local', '--local', '--port', port, '--persist-to', persistenceDirectory],
  {
    cwd: new URL('..', import.meta.url),
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let diagnostics = '';
worker.stdout.on('data', (chunk) => (diagnostics += chunk.toString()));
worker.stderr.on('data', (chunk) => (diagnostics += chunk.toString()));

try {
  let apiResponse;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      apiResponse = await fetch(`http://127.0.0.1:${port}/api/v1/platform`);
      break;
    } catch {
      await delay(250);
    }
  }

  if (!apiResponse?.ok) {
    throw new Error(`Local Worker API did not start.\n${diagnostics}`);
  }

  const payload = await apiResponse.json();
  if (payload.application !== 'startree' || payload.bookmarkRevision !== 0) {
    throw new Error(`Unexpected local API response: ${JSON.stringify(payload)}`);
  }

  const clientResponse = await fetch(`http://127.0.0.1:${port}/bookmarks/foundation`);
  const clientHtml = await clientResponse.text();
  if (!clientResponse.ok || !clientHtml.includes('<div id="app"></div>')) {
    throw new Error(
      'The local Worker did not serve the client application for an HTML5 history route.',
    );
  }
  if (!clientResponse.headers.get('content-security-policy')?.includes("default-src 'self'")) {
    throw new Error('The local Worker did not apply baseline security headers to client assets.');
  }

  console.log('Local Worker served both the D1-backed Hono API and Vue client assets.');
} finally {
  worker.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => worker.once('exit', resolve)), delay(2_000)]);
}
