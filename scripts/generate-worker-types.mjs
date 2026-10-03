import { readFileSync, writeFileSync } from 'node:fs';
import { run } from './process.mjs';
run('npx', ['cf', 'workers', 'types', '--mode', 'local', '--include-runtime=false']);
const types = readFileSync(
  new URL('../.cloudflare/types/index.d.ts', import.meta.url),
  'utf8',
).replaceAll('../../cloudflare.config', './cloudflare.config');
writeFileSync(new URL('../worker-configuration.d.ts', import.meta.url), types);
