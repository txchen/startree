import * as v from 'valibot';
import { vaultRecordSchema, type VaultRecord, type VaultWrite } from '../../shared/notes/contracts';
import type { BookmarkDatabase } from '../bookmarks/bookmark-database';

type Row = { revision: number; operation_id: string; updated_at: string; ciphertext_json: string };
const decode = (row: Row): VaultRecord =>
  v.parse(vaultRecordSchema, {
    revision: row.revision,
    operationId: row.operation_id,
    updatedAt: row.updated_at,
    vault: JSON.parse(row.ciphertext_json),
  });
export const createNotesService = (database: Pick<BookmarkDatabase, 'prepare'>) => ({
  async read(): Promise<VaultRecord | null> {
    const row = await database
      .prepare('SELECT * FROM encrypted_notes_vault WHERE singleton = 1')
      .first<Row>();
    return row ? decode(row) : null;
  },
  async write(command: VaultWrite): Promise<VaultRecord | null> {
    const payload = JSON.stringify(command.vault);
    const now = new Date().toISOString();
    const row =
      command.expectedRevision === 0
        ? await database
            .prepare(
              'INSERT INTO encrypted_notes_vault (singleton, revision, operation_id, updated_at, ciphertext_json) VALUES (1, 1, ?, ?, ?) ON CONFLICT(singleton) DO NOTHING RETURNING *',
            )
            .bind(command.operationId, now, payload)
            .first<Row>()
        : await database
            .prepare(
              'UPDATE encrypted_notes_vault SET revision = revision + 1, operation_id = ?, updated_at = ?, ciphertext_json = ? WHERE singleton = 1 AND revision = ? RETURNING *',
            )
            .bind(command.operationId, now, payload, command.expectedRevision)
            .first<Row>();
    if (row) return decode(row);
    // A lost acknowledgement can safely be retried without changing the revision again.
    const existing = await database
      .prepare('SELECT * FROM encrypted_notes_vault WHERE singleton = 1 AND operation_id = ?')
      .bind(command.operationId)
      .first<Row>();
    return existing && existing.ciphertext_json === payload ? decode(existing) : null;
  },
});
