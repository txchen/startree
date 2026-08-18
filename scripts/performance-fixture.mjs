const ROOT_ID = '00000000-0000-4000-8000-000000000000';
const STAMP = '2026-01-01T00:00:00.000Z';
const id = (prefix, value) => `${prefix}0000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

const fixtureCases = {
  hierarchy: {
    folderCount: 1_000,
    bookmarkCount: 10_000,
    maximumDepth: 10,
    maximumFieldSamples: false,
    parentId: (index) => {
      if (index === 1) return ROOT_ID;
      if (index <= 10) return id('2', index - 1);
      return id('2', ((index - 11) % 9) + 1);
    },
    bookmarkFolderIndex: (index) => ((index - 1) % 1_000) + 1,
  },
  concentration: {
    folderCount: 1_000,
    bookmarkCount: 10_000,
    maximumDepth: 1,
    maximumFieldSamples: false,
    parentId: () => ROOT_ID,
    bookmarkFolderIndex: () => 1,
    manifest: { concentratedFolderId: id('2', 1) },
  },
  'maximum-fields': {
    folderCount: 1,
    bookmarkCount: 1,
    maximumDepth: 1,
    maximumFieldSamples: true,
    parentId: () => ROOT_ID,
    bookmarkFolderIndex: () => 1,
  },
};

const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const valuesInChunks = (table, columns, rows) => {
  const statements = [];
  for (let start = 0; start < rows.length; start += 100) {
    statements.push(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${rows
        .slice(start, start + 100)
        .map(
          (row) =>
            `(${row.map((value) => (typeof value === 'number' ? value : quote(value))).join(', ')})`,
        )
        .join(',\n')};`,
    );
  }
  return statements;
};

const reset = [
  'DELETE FROM bookmark_tags;',
  'DELETE FROM bookmark_idempotency_results;',
  'DELETE FROM bookmark_command_assertions;',
  'DELETE FROM bookmarks;',
  `DELETE FROM bookmark_sequences WHERE folder_id != '${ROOT_ID}';`,
  `DELETE FROM bookmark_folders WHERE id != '${ROOT_ID}';`,
  `UPDATE bookmark_sequences SET version = 1 WHERE folder_id = '${ROOT_ID}';`,
  "UPDATE bookmark_domain_state SET revision = 1 WHERE name = 'bookmarks';",
];

const maximumSamples = () => {
  const urlPrefix = 'https://example.com/';
  return {
    url: urlPrefix + 'u'.repeat(8_192 - urlPrefix.length),
    title: 'T'.repeat(256),
    note: 'N'.repeat(32_768),
    tags: Array.from({ length: 50 }, (_, index) =>
      `Tag-${String(index + 1).padStart(2, '0')}`.padEnd(64, 'x'),
    ),
  };
};

export const buildPerformanceFixture = (fixtureCase) => {
  const descriptor = fixtureCases[fixtureCase];
  if (!descriptor) throw new Error(`Unknown performance fixture: ${fixtureCase}`);

  const { bookmarkCount, folderCount, maximumFieldSamples } = descriptor;
  const folders = [];
  const sequences = [];
  for (let index = 1; index <= folderCount; index += 1) {
    const folderId = id('2', index);
    folders.push([
      folderId,
      maximumFieldSamples ? 'F'.repeat(256) : `Performance Folder ${index}`,
      descriptor.parentId(index),
      String(index).padStart(12, '0'),
      STAMP,
      STAMP,
      1,
    ]);
    sequences.push([folderId, 'folders', 1], [folderId, 'bookmarks', 1]);
  }

  const samples = maximumSamples();
  const bookmarks = [];
  const tags = [];
  for (let index = 1; index <= bookmarkCount; index += 1) {
    const bookmarkId = id('3', index);
    const folderIndex = descriptor.bookmarkFolderIndex(index);
    bookmarks.push([
      bookmarkId,
      id('2', folderIndex),
      maximumFieldSamples ? samples.url : `https://example.com/performance/${index}`,
      maximumFieldSamples ? samples.title : `Performance Bookmark ${index}`,
      maximumFieldSamples ? samples.note : `Representative Note ${index}`,
      String(index).padStart(12, '0'),
      STAMP,
      STAMP,
      1,
    ]);
    if (maximumFieldSamples) {
      samples.tags.forEach((tag) => tags.push([bookmarkId, tag, tag.toLowerCase()]));
    } else if (index % 10 === 0) {
      tags.push([bookmarkId, `Topic ${index % 100}`, `topic ${index % 100}`]);
    }
  }

  const sql = [
    'PRAGMA foreign_keys = ON;',
    'BEGIN TRANSACTION;',
    ...reset,
    ...valuesInChunks(
      'bookmark_folders',
      ['id', 'name', 'parent_id', 'rank', 'created_at', 'modified_at', 'version'],
      folders,
    ),
    ...valuesInChunks('bookmark_sequences', ['folder_id', 'kind', 'version'], sequences),
    ...valuesInChunks(
      'bookmarks',
      ['id', 'folder_id', 'url', 'title', 'note', 'rank', 'created_at', 'modified_at', 'version'],
      bookmarks,
    ),
    ...valuesInChunks('bookmark_tags', ['bookmark_id', 'display_value', 'lowercase_key'], tags),
    'COMMIT;',
  ].join('\n');

  return {
    manifest: {
      case: fixtureCase,
      bookmarks: bookmarkCount,
      folders: folderCount,
      maximumDepth: descriptor.maximumDepth,
      maximumFieldSamples,
      ...descriptor.manifest,
    },
    sql,
    ...(maximumFieldSamples ? { samples } : {}),
  };
};
