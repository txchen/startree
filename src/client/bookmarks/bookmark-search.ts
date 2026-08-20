import MiniSearch, { type SearchResult } from 'minisearch';

import {
  SYSTEM_ROOT_FOLDER_ID,
  type Bookmark,
  type BookmarkSnapshot,
} from '../../shared/bookmarks/contracts';
import { bookmarkDomain } from './bookmark-library';

export const BOOKMARK_SEARCH_RESULT_LIMIT = 20;

export type BookmarkSearchScope = 'global' | 'selected-folder';

export type BookmarkSearchContext = {
  label: 'URL' | 'Tag' | 'Note';
  text: string;
};

export type BookmarkSearchFilters = Readonly<{
  tags: readonly string[];
  domains: readonly string[];
}>;

export const EMPTY_BOOKMARK_SEARCH_FILTERS: BookmarkSearchFilters = {
  tags: [],
  domains: [],
};

export const bookmarkSearchFiltersActive = (filters: BookmarkSearchFilters): boolean =>
  filters.tags.length > 0 || filters.domains.length > 0;

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
  search(
    query: string,
    filters?: BookmarkSearchFilters,
    scopeFolderId?: string | null,
  ): Promise<readonly BookmarkSearchResult[]>;
  revision(): number | null;
  dispose(): void;
};

type SearchDocument = BookmarkSearchResult & {
  documentId: string;
  urlText: string;
  tagText: string;
  noteText: string;
  scopeFolderIds: string[];
};

const createIndex = () =>
  new MiniSearch<SearchDocument>({
    idField: 'documentId',
    fields: ['title', 'urlText', 'tagText', 'noteText'],
    storeFields: [
      'kind',
      'id',
      'title',
      'folderId',
      'folderPath',
      'url',
      'note',
      'tags',
      'scopeFolderIds',
    ],
    searchOptions: {
      boost: { title: 12, tagText: 5, urlText: 3, noteText: 1 },
      prefix: true,
    },
  });

type ActiveFolderDetails = Readonly<{
  path: string;
  scopeFolderIds: string[];
}>;

const activeFolderDetails = (snapshot: BookmarkSnapshot): Map<string, ActiveFolderDetails> => {
  const foldersByParent = new Map<string, typeof snapshot.folders>();
  for (const folder of snapshot.folders) {
    if (folder.parentId === null) continue;
    const siblings = foldersByParent.get(folder.parentId) ?? [];
    foldersByParent.set(folder.parentId, [...siblings, folder]);
  }

  const details = new Map<string, ActiveFolderDetails>([
    [SYSTEM_ROOT_FOLDER_ID, { path: 'Bookmarks', scopeFolderIds: [] }],
  ]);
  const pending = [SYSTEM_ROOT_FOLDER_ID];
  while (pending.length) {
    const parentId = pending.shift();
    if (!parentId) continue;
    const parentDetails = details.get(parentId);
    if (!parentDetails) continue;
    for (const child of foldersByParent.get(parentId) ?? []) {
      if (details.has(child.id)) continue;
      details.set(child.id, {
        path: `${parentDetails.path} / ${child.name}`,
        scopeFolderIds: [...parentDetails.scopeFolderIds, parentId],
      });
      pending.push(child.id);
    }
  }
  return details;
};

const documentsFor = (snapshot: BookmarkSnapshot): SearchDocument[] => {
  const folderDetails = activeFolderDetails(snapshot);
  const tagsByBookmark = new Map<string, string[]>();
  for (const tag of snapshot.tags) {
    const tags = tagsByBookmark.get(tag.bookmarkId) ?? [];
    tags.push(tag.value);
    tagsByBookmark.set(tag.bookmarkId, tags);
  }

  const documents: SearchDocument[] = [];
  for (const folder of snapshot.folders) {
    const details = folderDetails.get(folder.id);
    if (!details || folder.id === SYSTEM_ROOT_FOLDER_ID) continue;
    documents.push({
      kind: 'folder',
      documentId: `folder:${folder.id}`,
      id: folder.id,
      title: folder.name,
      folderId: folder.id,
      folderPath: details.path,
      urlText: '',
      tagText: '',
      noteText: '',
      scopeFolderIds: details.scopeFolderIds,
    });
  }

  for (const bookmark of snapshot.bookmarks) {
    const details = folderDetails.get(bookmark.folderId);
    if (!details) continue;
    const tags = tagsByBookmark.get(bookmark.id) ?? [];
    documents.push(
      bookmarkDocument(bookmark, details.path, tags, [
        ...details.scopeFolderIds,
        bookmark.folderId,
      ]),
    );
  }
  return documents;
};

const bookmarkDocument = (
  bookmark: Bookmark,
  folderPath: string,
  tags: string[],
  scopeFolderIds: string[],
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
  scopeFolderIds,
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

const resultFromDocument = (document: SearchDocument): BookmarkSearchResult => {
  if (document.kind === 'folder') {
    return {
      kind: 'folder',
      id: document.id,
      title: document.title,
      folderId: document.folderId,
      folderPath: document.folderPath,
    };
  }
  return {
    kind: 'bookmark',
    id: document.id,
    title: document.title,
    folderId: document.folderId,
    folderPath: document.folderPath,
    url: document.url,
    note: document.note,
    tags: document.tags,
  };
};

type FilterableSearchDocument = Readonly<{
  kind: BookmarkSearchResult['kind'];
  url?: string;
  tags?: readonly string[];
  scopeFolderIds: readonly string[];
}>;

const matchesFilters = (
  document: FilterableSearchDocument,
  filters: BookmarkSearchFilters,
  scopeFolderId: string | null,
): boolean => {
  if (scopeFolderId && !document.scopeFolderIds.includes(scopeFolderId)) return false;
  if (!bookmarkSearchFiltersActive(filters)) return true;
  if (document.kind !== 'bookmark' || !document.url) return false;
  const normalizedTags = new Set((document.tags ?? []).map((tag) => tag.toLocaleLowerCase()));
  const tagMatch =
    filters.tags.length === 0 ||
    filters.tags.every((tag) => normalizedTags.has(tag.toLocaleLowerCase()));
  const domainMatch =
    filters.domains.length === 0 || filters.domains.includes(bookmarkDomain(document.url));
  return tagMatch && domainMatch;
};

export const createMiniSearchBookmarkAdapter = (): BookmarkSearchAdapter => {
  let index = createIndex();
  let documents: SearchDocument[] = [];
  let indexedRevision: number | null = null;
  return {
    async replace(snapshot) {
      if (snapshot.revision === indexedRevision) return;
      const replacement = createIndex();
      documents = documentsFor(snapshot);
      replacement.addAll(documents);
      index = replacement;
      indexedRevision = snapshot.revision;
    },
    async search(query, filters = EMPTY_BOOKMARK_SEARCH_FILTERS, scopeFolderId = null) {
      const normalized = query.trim();
      if (!normalized) {
        return bookmarkSearchFiltersActive(filters)
          ? documents
              .filter((document) => matchesFilters(document, filters, scopeFolderId))
              .slice(0, BOOKMARK_SEARCH_RESULT_LIMIT)
              .map(resultFromDocument)
          : [];
      }
      return index
        .search(normalized)
        .filter((result) =>
          matchesFilters(
            {
              kind: String(result.kind) as SearchDocument['kind'],
              url: String(result.url ?? ''),
              tags: Array.isArray(result.tags) ? result.tags.map(String) : [],
              scopeFolderIds: Array.isArray(result.scopeFolderIds)
                ? result.scopeFolderIds.map(String)
                : [],
            },
            filters,
            scopeFolderId,
          ),
        )
        .slice(0, BOOKMARK_SEARCH_RESULT_LIMIT)
        .map((result) => resultFrom(result));
    },
    revision: () => indexedRevision,
    dispose() {
      index = createIndex();
      documents = [];
      indexedRevision = null;
    },
  };
};

type SearchWorkerCommand =
  | { type: 'replace'; snapshot: BookmarkSnapshot }
  | {
      type: 'search';
      query: string;
      filters: BookmarkSearchFilters;
      scopeFolderId: string | null;
    };
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
    async search(query, filters = EMPTY_BOOKMARK_SEARCH_FILTERS, scopeFolderId = null) {
      const response = await send({ type: 'search', query, filters, scopeFolderId });
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
