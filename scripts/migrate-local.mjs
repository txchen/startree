import { d1Migrations } from './cloudflare.mjs';
d1Migrations('apply', 'local', { locationArgs: ['--local', '--persist-to', '.wrangler/state'] });
