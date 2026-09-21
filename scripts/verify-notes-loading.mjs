import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const manifest = JSON.parse(
  readFileSync(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8'),
);
const entry = manifest['index.html'];
const main = readFileSync(new URL(`../dist/${entry.file}`, import.meta.url));
// Baseline 491fae3: 48,364 bytes gzip. Allow only the small navigation/loading shell.
assert.ok(
  gzipSync(main).length <= 48_364 + 3_072,
  'Bookmark entry gzip exceeded the Notes navigation budget',
);
assert.ok(!main.toString().includes('PBKDF2'), 'Cryptography must stay out of the Bookmark entry');
const notes = manifest['src/client/notes/NotesPage.vue'];
assert.ok(notes?.isDynamicEntry);
const eagerFiles = new Set();
const visit = (name) => {
  const asset = manifest[name];
  if (eagerFiles.has(asset.file)) return;
  eagerFiles.add(asset.file);
  for (const dependency of asset.imports ?? []) visit(dependency);
};
visit('index.html');
assert.ok(!eagerFiles.has(notes.file), 'Notes cannot be an eager dependency of Bookmarks');
const worker = readFileSync(new URL('../dist/service-worker.js', import.meta.url), 'utf8');
for (const asset of Object.values(manifest)) {
  if (/^(NotesPage|notes-storage)/.test(asset.name)) {
    for (const file of [asset.file, ...(asset.css ?? [])])
      assert.ok(!worker.includes(file), `${file} must not be precached`);
  }
}
console.log(`Notes loading boundary passed; Bookmark entry gzip: ${gzipSync(main).length} bytes.`);
