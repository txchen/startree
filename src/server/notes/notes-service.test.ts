import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SqliteBookmarkDatabase } from '../bookmarks/sqlite-bookmark-database.test-support';
import { createNotesService } from './notes-service';
import { createVault } from '../../client/notes/notes-crypto';

describe('encrypted vault persistence', () => {
  it('atomically rejects competing setup and stale writes and recognizes a lost acknowledgement', async () => {
    const database = new SqliteBookmarkDatabase();
    database.exec(readFileSync('migrations/0004_encrypted_notes.sql', 'utf8'));
    const service = createNotesService(database);
    const { vault } = await createVault('a long test password');
    const initial = { expectedRevision: 0, operationId: crypto.randomUUID(), vault };
    expect(await service.read()).toBeNull();
    const saved = await service.write(initial);
    expect(saved?.revision).toBe(1);
    expect(await service.write(initial)).toEqual(saved);
    expect(await service.write({ ...initial, operationId: crypto.randomUUID() })).toBeNull();
    const next = { ...initial, expectedRevision: 1, operationId: crypto.randomUUID() };
    expect((await service.write(next))?.revision).toBe(2);
    expect(await service.write({ ...next, operationId: crypto.randomUUID() })).toBeNull();
    expect((await service.read())?.vault).toEqual(vault);
    database.close();
  });
});
