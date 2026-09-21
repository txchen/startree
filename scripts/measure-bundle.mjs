import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const directory = resolve(process.argv[2] ?? 'dist');
const html = readFileSync(`${directory}/index.html`, 'utf8');
const entry = html.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
if (!entry) throw new Error('The application entry was not found in index.html.');
const files = [
  entry,
  ...readdirSync(`${directory}/assets`)
    .filter((file) => file.startsWith('bookmark-search-worker-') && file.endsWith('.js'))
    .map((file) => `/assets/${file}`),
  '/service-worker.js',
];
const assets = files.map((file) => {
  const bytes = readFileSync(directory + file);
  return {
    file,
    bytes: bytes.length,
    gzipBytes: gzipSync(bytes).length,
    brotliBytes: brotliCompressSync(bytes).length,
  };
});
console.log(
  JSON.stringify(
    {
      assets,
      compression: 'Node zlib defaults; complete files including sourceMappingURL comments',
    },
    null,
    2,
  ),
);
