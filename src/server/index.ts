import { createApp } from './app/create-app';

type RevisionRow = { revision: number };

const readBookmarkRevision = async (bindings: Env): Promise<number> => {
  const row = await bindings.DB.prepare(
    "SELECT revision FROM bookmark_domain_state WHERE name = 'bookmarks'",
  ).first<RevisionRow>();

  return row?.revision ?? 0;
};

export default createApp<Env>(readBookmarkRevision);
