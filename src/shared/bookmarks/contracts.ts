import * as v from 'valibot';

export const SYSTEM_ROOT_FOLDER_ID = '00000000-0000-4000-8000-000000000000';
export const BOOKMARK_SNAPSHOT_WIRE_FORMAT_VERSION = 1;

const uuidV4Schema = v.pipe(
  v.string(),
  v.uuid(),
  v.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
);
const identifierSchema = uuidV4Schema;
const entityVersionSchema = v.pipe(v.number(), v.integer(), v.minValue(1));
const rankSchema = v.pipe(v.string(), v.minLength(1));
const timestampSchema = v.pipe(
  v.string(),
  v.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
);
const folderNameSchema = v.pipe(
  v.string(),
  v.maxLength(256),
  v.check((value) => value.trim().length > 0),
);
const bookmarkUrlSchema = v.pipe(
  v.string(),
  v.url(),
  v.maxLength(8192),
  v.check((value) => URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol)),
);
const bookmarkTitleSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.maxLength(256),
  v.check((value) => value.trim().length > 0),
);
const bookmarkNoteSchema = v.pipe(v.string(), v.maxLength(32768));
const bookmarkTagInputSchema = v.pipe(
  v.string(),
  v.transform((value) => value.trim()),
  v.minLength(1),
  v.maxLength(64),
);
const bookmarkTagsInputSchema = v.pipe(v.array(bookmarkTagInputSchema), v.maxLength(50));

export const normalizeBookmarkTags = (values: string[]): string[] => {
  const parsed = v.parse(bookmarkTagsInputSchema, values);
  const retained = new Map<string, string>();
  for (const value of parsed) {
    const key = value.toLocaleLowerCase();
    if (!retained.has(key)) retained.set(key, value);
  }
  return [...retained.values()].sort(
    (left, right) =>
      left.toLocaleLowerCase().localeCompare(right.toLocaleLowerCase()) ||
      left.localeCompare(right),
  );
};

export const bookmarkTitleFor = (url: string, title?: string): string =>
  title ?? new URL(url).hostname;

export const bookmarkFolderSchema = v.pipe(
  v.object({
    id: identifierSchema,
    name: v.pipe(v.string(), v.maxLength(256)),
    parentId: v.nullable(identifierSchema),
    rank: rankSchema,
    createdAt: timestampSchema,
    modifiedAt: timestampSchema,
    version: entityVersionSchema,
  }),
  v.check((folder) =>
    folder.id === SYSTEM_ROOT_FOLDER_ID ? folder.name === '' : folder.name.trim().length > 0,
  ),
);

export const bookmarkSchema = v.object({
  id: identifierSchema,
  folderId: identifierSchema,
  url: bookmarkUrlSchema,
  title: bookmarkTitleSchema,
  note: bookmarkNoteSchema,
  rank: rankSchema,
  createdAt: timestampSchema,
  modifiedAt: timestampSchema,
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

const commandBase = {
  operationId: uuidV4Schema,
};

export const createFolderCommandSchema = v.object({
  ...commandBase,
  type: v.literal('createFolder'),
  parentId: identifierSchema,
  expectedFolderSequenceVersion: entityVersionSchema,
  name: folderNameSchema,
});

export const editFolderCommandSchema = v.object({
  ...commandBase,
  type: v.literal('editFolder'),
  folderId: identifierSchema,
  folderVersion: entityVersionSchema,
  name: folderNameSchema,
});

export const createBookmarkCommandSchema = v.object({
  ...commandBase,
  type: v.literal('createBookmark'),
  folderId: identifierSchema,
  expectedBookmarkSequenceVersion: entityVersionSchema,
  url: bookmarkUrlSchema,
  title: v.optional(bookmarkTitleSchema),
  note: bookmarkNoteSchema,
  tags: bookmarkTagsInputSchema,
});

export const editBookmarkCommandSchema = v.object({
  ...commandBase,
  type: v.literal('editBookmark'),
  bookmarkId: identifierSchema,
  bookmarkVersion: entityVersionSchema,
  url: bookmarkUrlSchema,
  title: bookmarkTitleSchema,
  note: bookmarkNoteSchema,
  tags: bookmarkTagsInputSchema,
});

export const bookmarkCommandSchema = v.variant('type', [
  createFolderCommandSchema,
  editFolderCommandSchema,
  createBookmarkCommandSchema,
  editBookmarkCommandSchema,
]);

const commandRecords = {
  revision: v.pipe(v.number(), v.integer(), v.minValue(0)),
  folders: v.array(bookmarkFolderSchema),
  bookmarks: v.array(bookmarkSchema),
  tags: v.array(bookmarkTagSchema),
  sequences: v.array(bookmarkSequenceSchema),
};

export const bookmarkCommandResultSchema = v.variant('status', [
  v.object({
    status: v.literal('acknowledged'),
    operationId: uuidV4Schema,
    ...commandRecords,
  }),
  v.object({
    status: v.literal('conflict'),
    operationId: uuidV4Schema,
    code: v.picklist(['stale_entity', 'stale_sequence', 'name_conflict', 'missing_entity']),
    ...commandRecords,
  }),
]);

export type BookmarkCommand = v.InferOutput<typeof bookmarkCommandSchema>;
export type BookmarkCommandResult = v.InferOutput<typeof bookmarkCommandResultSchema>;

export const bookmarkSnapshotEtag = (revision: number): string =>
  `"bookmarks-${BOOKMARK_SNAPSHOT_WIRE_FORMAT_VERSION}-${revision}"`;
