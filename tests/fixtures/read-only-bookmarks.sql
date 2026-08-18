INSERT INTO bookmark_folders (
  id, name, parent_id, rank, created_at, modified_at, version
) VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    'Reading',
    '00000000-0000-4000-8000-000000000000',
    'a',
    '2026-08-18T12:00:00.000Z',
    '2026-08-18T12:00:00.000Z',
    1
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'Empty Folder',
    '00000000-0000-4000-8000-000000000000',
    'b',
    '2026-08-18T12:00:00.000Z',
    '2026-08-18T12:00:00.000Z',
    1
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'Articles',
    '10000000-0000-4000-8000-000000000001',
    'a',
    '2026-08-18T12:00:00.000Z',
    '2026-08-18T12:00:00.000Z',
    1
  );

INSERT INTO bookmark_sequences (folder_id, kind, version) VALUES
  ('10000000-0000-4000-8000-000000000001', 'folders', 1),
  ('10000000-0000-4000-8000-000000000001', 'bookmarks', 1),
  ('10000000-0000-4000-8000-000000000002', 'folders', 1),
  ('10000000-0000-4000-8000-000000000002', 'bookmarks', 1),
  ('10000000-0000-4000-8000-000000000003', 'folders', 1),
  ('10000000-0000-4000-8000-000000000003', 'bookmarks', 1);

INSERT INTO bookmarks (
  id, folder_id, url, title, note, rank, created_at, modified_at, version
) VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'https://example.com/reference',
    'Example Reference',
    'A useful reference for complete-Worker verification.',
    'a',
    '2026-08-18T12:00:00.000Z',
    '2026-08-18T12:00:00.000Z',
    1
  );

INSERT INTO bookmark_tags (bookmark_id, display_value, lowercase_key) VALUES
  ('20000000-0000-4000-8000-000000000001', 'Reference', 'reference'),
  ('20000000-0000-4000-8000-000000000001', '阅读', '阅读');

UPDATE bookmark_domain_state SET revision = 1 WHERE name = 'bookmarks';
