import MiniSearch, { type SearchResult } from 'minisearch';

import {
  SYSTEM_ROOT_FOLDER_ID,
  type Bookmark,
  type BookmarkSnapshot,
} from '../../shared/bookmarks/contracts';

export const BOOKMARK_SEARCH_RESULT_LIMIT = 20;

export type BookmarkSearchContext = {
  label: 'URL' | 'Tag' | 'Note';
  text: string;
};

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
      context?: BookmarkSearchContext;
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

const noteExcerpt = (note: string, terms: readonly string[]): string => {
  const compact = note.replace(/\s+/g, ' ').trim();
  if (compact.length <= 90) return compact;
  const lower = compact.toLocaleLowerCase();
  const position = Math.min(
    ...terms.map((term) => lower.indexOf(term.toLocaleLowerCase())).filter((index) => index >= 0),
  );
  const matchPosition = Number.isFinite(position) ? position : 0;
  const start = Math.min(Math.max(0, matchPosition - 28), compact.length - 90);
  const end = Math.min(compact.length, start + 90);
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
};

const contextFor = (result: SearchResult): BookmarkSearchContext | undefined => {
  const fields = new Set(Object.values(result.match).flat());
  if (fields.has('title')) return undefined;
  const terms = result.terms.map((term) => term.toLocaleLowerCase());
  if (fields.has('tagText')) {
    const tags = Array.isArray(result.tags) ? result.tags.map(String) : [];
    const tag = tags.find((value) =>
      terms.some((term) => value.toLocaleLowerCase().includes(term)),
    );
    return { label: 'Tag', text: tag ?? tags[0] ?? '' };
  }
  if (fields.has('urlText')) {
    const url = String(result.url);
    try {
      return { label: 'URL', text: new URL(url).hostname };
    } catch {
      return { label: 'URL', text: url };
    }
  }
  if (fields.has('noteText')) {
    return { label: 'Note', text: noteExcerpt(String(result.note), result.terms) };
  }
  return undefined;
};

const resultFrom = (result: SearchResult): BookmarkSearchResult => {
  if (result.kind === 'folder') {
    return {
      kind: 'folder',
      id: String(result.id),
      title: String(result.title),
      folderId: String(result.folderId),
      folderPath: String(result.folderPath),
    };
  }
  const context = contextFor(result);
  return {
    kind: 'bookmark',
    id: String(result.id),
    title: String(result.title),
    folderId: String(result.folderId),
    folderPath: String(result.folderPath),
    url: String(result.url),
    note: String(result.note),
    tags: Array.isArray(result.tags) ? result.tags.map(String) : [],
    ...(context ? { context } : {}),
  };
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
      return index
        .search(normalized)
        .slice(0, BOOKMARK_SEARCH_RESULT_LIMIT)
        .map((result) => resultFrom(result));
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
