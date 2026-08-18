import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPerformanceFixture } from './performance-fixture.mjs';

test('hierarchical fixture represents the full library and ten Folder levels', () => {
  const fixture = buildPerformanceFixture('hierarchy');
  assert.deepEqual(fixture.manifest, {
    case: 'hierarchy',
    bookmarks: 10_000,
    folders: 1_000,
    maximumDepth: 10,
    maximumFieldSamples: false,
  });
  assert.match(fixture.sql, /Performance Bookmark 10000/);
});

test('concentration fixture places all Bookmarks in one Folder', () => {
  const fixture = buildPerformanceFixture('concentration');
  assert.equal(fixture.manifest.bookmarks, 10_000);
  assert.equal(fixture.manifest.concentratedFolderId, '20000000-0000-4000-8000-000000000001');
  assert.doesNotMatch(
    fixture.sql,
    /30000000-0000-4000-8000-000000010000', '20000000-0000-4000-8000-000000000002'/,
  );
});

test('maximum-field fixture exercises every settled field boundary separately', () => {
  const fixture = buildPerformanceFixture('maximum-fields');
  assert.deepEqual(fixture.manifest, {
    case: 'maximum-fields',
    bookmarks: 1,
    folders: 1,
    maximumDepth: 1,
    maximumFieldSamples: true,
  });
  assert.equal(fixture.samples.url.length, 8_192);
  assert.equal(fixture.samples.title.length, 256);
  assert.equal(fixture.samples.note.length, 32_768);
  assert.equal(fixture.samples.tags.length, 50);
  assert.ok(fixture.samples.tags.every((tag) => tag.length === 64));
});
