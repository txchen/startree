import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

import type {
  BookmarkDatabase,
  BookmarkDatabaseResult,
  BookmarkDatabaseStatement,
} from './bookmark-database';

const sqliteValues = (values: unknown[]): SQLInputValue[] => values as SQLInputValue[];

class SqliteBookmarkStatement implements BookmarkDatabaseStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly statement: StatementSync,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): SqliteBookmarkStatement {
    return new SqliteBookmarkStatement(this.database, this.statement, values);
  }

  async first<Row = Record<string, unknown>>(): Promise<Row | null> {
    return (this.statement.get(...sqliteValues(this.values)) as Row | undefined) ?? null;
  }

  async all<Row = Record<string, unknown>>(): Promise<BookmarkDatabaseResult<Row>> {
    return { results: this.execute<Row>() };
  }

  async run<Row = Record<string, unknown>>(): Promise<BookmarkDatabaseResult<Row>> {
    return { results: this.execute<Row>() };
  }

  execute<Row>(database: DatabaseSync = this.database): Row[] {
    if (database !== this.database) {
      throw new TypeError('SQLite batches accept only statements prepared by the same database.');
    }
    return this.statement.all(...sqliteValues(this.values)) as Row[];
  }
}

export class SqliteBookmarkDatabase implements BookmarkDatabase {
  private readonly database = new DatabaseSync(':memory:');

  prepare(query: string): SqliteBookmarkStatement {
    return new SqliteBookmarkStatement(this.database, this.database.prepare(query));
  }

  async batch<Row = Record<string, unknown>>(
    statements: BookmarkDatabaseStatement[],
  ): Promise<BookmarkDatabaseResult<Row>[]> {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement) => {
        if (!(statement instanceof SqliteBookmarkStatement)) {
          throw new TypeError('SQLite batches accept only statements prepared by this adapter.');
        }
        return { results: statement.execute<Row>(this.database) };
      });
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  exec(query: string): void {
    this.database.exec(query);
  }

  close(): void {
    this.database.close();
  }
}
