export type BookmarkDatabaseResult<Row> = {
  results: Row[];
};

export type BookmarkDatabaseStatement = {
  bind(...values: unknown[]): BookmarkDatabaseStatement;
  first<Row = Record<string, unknown>>(): Promise<Row | null>;
  all<Row = Record<string, unknown>>(): Promise<BookmarkDatabaseResult<Row>>;
};

export type BookmarkDatabase = {
  prepare(query: string): BookmarkDatabaseStatement;
  batch<Row = Record<string, unknown>>(
    statements: BookmarkDatabaseStatement[],
  ): Promise<BookmarkDatabaseResult<Row>[]>;
};
