import MiniSearch from 'minisearch';

import {
  SYSTEM_ROOT_FOLDER_ID,
  type Bookmark,
  type BookmarkSnapshot,
} from '../../shared/bookmarks/contracts';

export type BookmarkSearchResult =
  | {
      kind: 'folder';
      id: string;
      title: string;
      folderId: string;
      folderPath: string;
    }
  | {
      kind: 'bookmark';
      id: string;
      title: string;
      folderId: string;
      folderPath: string;
      url: string;
      note: string;
      tags: string[];
    };

export type BookmarkSearchAdapter = {
  replace(snapshot: BookmarkSnapshot): Promise<void>;
  search(query: string): Promise<readonly BookmarkSearchResult[]>;
  revision(): number | null;
  dispose(): void;
};

type SearchDocument = BookmarkSearchResult & {
  documentId: string;
  urlText: string;
  tagText: string;
  noteText: string;
};

const createIndex = () =>
  new MiniSearch<SearchDocument>({
    idField: 'documentId',
    fields: ['title', 'urlText', 'tagText', 'noteText'],
    storeFields: ['kind', 'id', 'title', 'folderId', 'folderPath', 'url', 'note', 'tags'],
    searchOptions: {
      boost: { title: 12, tagText: 5, urlText: 3, noteText: 1 },
      prefix: true,
    },
  });

const activeFolderPaths = (snapshot: BookmarkSnapshot): Map<string, string> => {
  const foldersByParent = new Map<string, typeof snapshot.folders>();
  for (const folder of snapshot.folders) {
    if (folder.parentId === null) continue;
    const siblings = foldersByParent.get(folder.parentId) ?? [];
    foldersByParent.set(folder.parentId, [...siblings, folder]);
  }

  const paths = new Map<string, string>([[SYSTEM_ROOT_FOLDER_ID, 'Bookmarks']]);
  const pending = [SYSTEM_ROOT_FOLDER_ID];
  while (pending.length) {
    const parentId = pending.shift();
    if (!parentId) continue;
    const parentPath = paths.get(parentId);
    if (!parentPath) continue;
    for (const child of foldersByParent.get(parentId) ?? []) {
      if (paths.has(child.id)) continue;
      paths.set(child.id, `${parentPath} / ${child.name}`);
      pending.push(child.id);
    }
  }
  return paths;
};

const documentsFor = (snapshot: BookmarkSnapshot): SearchDocument[] => {
  const paths = activeFolderPaths(snapshot);
  const tagsByBookmark = new Map<string, string[]>();
  for (const tag of snapshot.tags) {
    const tags = tagsByBookmark.get(tag.bookmarkId) ?? [];
    tags.push(tag.value);
    tagsByBookmark.set(tag.bookmarkId, tags);
  }

  const documents: SearchDocument[] = [];
  for (const folder of snapshot.folders) {
    const folderPath = paths.get(folder.id);
    if (!folderPath || folder.id === SYSTEM_ROOT_FOLDER_ID) continue;
    documents.push({
      kind: 'folder',
      documentId: `folder:${folder.id}`,
      id: folder.id,
      title: folder.name,
      folderId: folder.id,
      folderPath,
      urlText: '',
      tagText: '',
      noteText: '',
    });
  }

  for (const bookmark of snapshot.bookmarks) {
    const folderPath = paths.get(bookmark.folderId);
    if (!folderPath) continue;
    const tags = tagsByBookmark.get(bookmark.id) ?? [];
    documents.push(bookmarkDocument(bookmark, folderPath, tags));
  }
  return documents;
};

const bookmarkDocument = (
  bookmark: Bookmark,
  folderPath: string,
  tags: string[],
): SearchDocument => ({
  kind: 'bookmark',
  documentId: `bookmark:${bookmark.id}`,
  id: bookmark.id,
  title: bookmark.title,
  folderId: bookmark.folderId,
  folderPath,
  url: bookmark.url,
  note: bookmark.note,
  tags,
  urlText: bookmark.url,
  tagText: tags.join(' '),
  noteText: bookmark.note,
});

const resultFrom = (result: Record<string, unknown>): BookmarkSearchResult =>
  result.kind === 'folder'
    ? {
        kind: 'folder',
        id: String(result.id),
        title: String(result.title),
        folderId: String(result.folderId),
        folderPath: String(result.folderPath),
      }
    : {
        kind: 'bookmark',
        id: String(result.id),
        title: String(result.title),
        folderId: String(result.folderId),
        folderPath: String(result.folderPath),
        url: String(result.url),
        note: String(result.note),
        tags: Array.isArray(result.tags) ? result.tags.map(String) : [],
      };

export const createMiniSearchBookmarkAdapter = (): BookmarkSearchAdapter => {
  let index = createIndex();
  let indexedRevision: number | null = null;
  return {
    async replace(snapshot) {
      if (snapshot.revision === indexedRevision) return;
      const replacement = createIndex();
      replacement.addAll(documentsFor(snapshot));
      index = replacement;
      indexedRevision = snapshot.revision;
    },
    async search(query) {
      const normalized = query.trim();
      if (!normalized) return [];
      return index.search(normalized).map((result) => resultFrom(result));
    },
    revision: () => indexedRevision,
    dispose() {
      index = createIndex();
      indexedRevision = null;
    },
  };
};

type SearchWorkerCommand =
  | { type: 'replace'; snapshot: BookmarkSnapshot }
  | { type: 'search'; query: string };
type SearchWorkerRequest = SearchWorkerCommand & { requestId: number };

type SearchWorkerResponse =
  | { requestId: number; type: 'replaced'; revision: number }
  | { requestId: number; type: 'results'; results: BookmarkSearchResult[] }
  | { requestId: number; type: 'error'; message: string };

export const createWorkerBookmarkSearchAdapter = (
  worker: Worker = new Worker(new URL('./bookmark-search-worker.ts', import.meta.url), {
    type: 'module',
  }),
): BookmarkSearchAdapter => {
  let requestId = 0;
  let indexedRevision: number | null = null;
  const pending = new Map<
    number,
    { resolve(value: SearchWorkerResponse): void; reject(reason: Error): void }
  >();
  worker.addEventListener('message', (event: MessageEvent<SearchWorkerResponse>) => {
    const request = pending.get(event.data.requestId);
    if (!request) return;
    pending.delete(event.data.requestId);
    if (event.data.type === 'error') request.reject(new Error(event.data.message));
    else request.resolve(event.data);
  });

  const send = (request: SearchWorkerCommand): Promise<SearchWorkerResponse> => {
    const nextRequestId = ++requestId;
    return new Promise((resolve, reject) => {
      pending.set(nextRequestId, { resolve, reject });
      worker.postMessage({ ...request, requestId: nextRequestId });
    });
  };

  return {
    async replace(snapshot) {
      if (snapshot.revision === indexedRevision) return;
      const response = await send({ type: 'replace', snapshot });
      if (response.type === 'replaced') indexedRevision = response.revision;
    },
    async search(query) {
      const response = await send({ type: 'search', query });
      return response.type === 'results' ? response.results : [];
    },
    revision: () => indexedRevision,
    dispose() {
      for (const request of pending.values()) request.reject(new Error('Search Worker stopped.'));
      pending.clear();
      worker.terminate();
      indexedRevision = null;
    },
  };
};

export type { SearchWorkerRequest, SearchWorkerResponse };
