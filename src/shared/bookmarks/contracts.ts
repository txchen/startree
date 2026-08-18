import * as v from 'valibot';

export const SYSTEM_ROOT_FOLDER_ID = '00000000-0000-4000-8000-000000000000';
export const BOOKMARK_SNAPSHOT_WIRE_FORMAT_VERSION = 1;

const identifierSchema = v.pipe(v.string(), v.uuid());
const entityVersionSchema = v.pipe(v.number(), v.integer(), v.minValue(1));
const rankSchema = v.pipe(v.string(), v.minLength(1));

export const bookmarkFolderSchema = v.pipe(
  v.object({
    id: identifierSchema,
    name: v.pipe(v.string(), v.maxLength(256)),
    parentId: v.nullable(identifierSchema),
    rank: rankSchema,
    createdAt: v.string(),
    modifiedAt: v.string(),
    version: entityVersionSchema,
  }),
  v.check((folder) =>
    folder.id === SYSTEM_ROOT_FOLDER_ID ? folder.name === '' : folder.name.trim().length > 0,
  ),
);

export const bookmarkSchema = v.object({
  id: identifierSchema,
  folderId: identifierSchema,
  url: v.pipe(
    v.string(),
    v.url(),
    v.maxLength(8192),
    v.check(
      (value) => URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol),
    ),
  ),
  title: v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(256),
    v.check((value) => value.trim().length > 0),
  ),
  note: v.pipe(v.string(), v.maxLength(32768)),
  rank: rankSchema,
  createdAt: v.string(),
  modifiedAt: v.string(),
  version: entityVersionSchema,
});

export const bookmarkTagSchema = v.object({
  bookmarkId: identifierSchema,
  value: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
});

export const bookmarkSequenceSchema = v.object({
  folderId: identifierSchema,
  folderVersion: entityVersionSchema,
  bookmarkVersion: entityVersionSchema,
});

export const bookmarkSnapshotSchema = v.object({
  wireFormatVersion: v.literal(BOOKMARK_SNAPSHOT_WIRE_FORMAT_VERSION),
  revision: v.pipe(v.number(), v.integer(), v.minValue(0)),
  folders: v.array(bookmarkFolderSchema),
  bookmarks: v.array(bookmarkSchema),
  tags: v.array(bookmarkTagSchema),
  sequences: v.array(bookmarkSequenceSchema),
});

export type BookmarkFolder = v.InferOutput<typeof bookmarkFolderSchema>;
export type Bookmark = v.InferOutput<typeof bookmarkSchema>;
export type BookmarkTag = v.InferOutput<typeof bookmarkTagSchema>;
export type BookmarkSequence = v.InferOutput<typeof bookmarkSequenceSchema>;
export type BookmarkSnapshot = v.InferOutput<typeof bookmarkSnapshotSchema>;

export const bookmarkSnapshotEtag = (revision: number): string =>
  `"bookmarks-${BOOKMARK_SNAPSHOT_WIRE_FORMAT_VERSION}-${revision}"`;
