import { createNotesService } from './notes/notes-service';
import { createApp } from './app/create-app';
import { createBookmarkService } from './bookmarks/bookmark-service';

type RevisionRow = { revision: number };

const readBookmarkRevision = async (bindings: Env): Promise<number> => {
  const row = await bindings.DB.prepare(
    "SELECT revision FROM bookmark_domain_state WHERE name = 'bookmarks'",
  ).first<RevisionRow>();

  return row?.revision ?? 0;
};

export default createApp<Env>({
  readBookmarkRevision,
  readNotesVault: (bindings) => createNotesService(bindings.DB).read(),
  writeNotesVault: (command, bindings) => createNotesService(bindings.DB).write(command),
  readBookmarkSnapshot: (bindings) => createBookmarkService(bindings.DB).getSnapshot(),
  readBookmarkTrash: (bindings) => createBookmarkService(bindings.DB).getTrash(),
  executeBookmarkCommand: (command, bindings) =>
    createBookmarkService(bindings.DB).executeCommand(command),
});
