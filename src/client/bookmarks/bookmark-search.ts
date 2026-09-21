import MiniSearch, { type SearchResult } from 'minisearch';

import { SYSTEM_ROOT_FOLDER_ID } from '../../shared/bookmarks/constants';
import type { Bookmark, BookmarkSnapshot } from '../../shared/bookmarks/contracts';
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
  // Position in the payload array, rebuilt with each snapshot.
  documentId: number;
  scopeFolderIds: readonly string[];
};

const createIndex = () =>
  new MiniSearch<SearchDocument>({
    // Keep result payloads in one array instead of duplicating them in storeFields.
    idField: 'documentId',
    fields: ['title', 'urlText', 'tagText', 'noteText'],
    extractField(document, field) {
      switch (field) {
        case 'documentId':
          return document.documentId;
        case 'title':
          return document.title;
        case 'urlText':
          return document.kind === 'bookmark' ? document.url : '';
        case 'tagText':
          return document.kind === 'bookmark' ? document.tags.join(' ') : '';
        case 'noteText':
          return document.kind === 'bookmark' ? document.note : '';
        default:
          return undefined;
      }
    },
    searchOptions: {
      boost: { title: 12, tagText: 5, urlText: 3, noteText: 1 },
      prefix: true,
    },
  });

type ActiveFolderDetails = Readonly<{
  path: string;
  scopeFolderIds: readonly string[];
  bookmarkScopeFolderIds: readonly string[];
}>;

const activeFolderDetails = (snapshot: BookmarkSnapshot): Map<string, ActiveFolderDetails> => {
  const foldersByParent = new Map<string, typeof snapshot.folders>();
  for (const folder of snapshot.folders) {
    if (folder.parentId === null) continue;
    const siblings = foldersByParent.get(folder.parentId) ?? [];
    foldersByParent.set(folder.parentId, [...siblings, folder]);
  }

  const details = new Map<string, ActiveFolderDetails>([
    [
      SYSTEM_ROOT_FOLDER_ID,
      { path: 'Bookmarks', scopeFolderIds: [], bookmarkScopeFolderIds: [SYSTEM_ROOT_FOLDER_ID] },
    ],
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
        scopeFolderIds: parentDetails.bookmarkScopeFolderIds,
        bookmarkScopeFolderIds: [...parentDetails.bookmarkScopeFolderIds, child.id],
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
      documentId: documents.length,
      id: folder.id,
      title: folder.name,
      folderId: folder.id,
      folderPath: details.path,
      scopeFolderIds: details.scopeFolderIds,
    });
  }

  for (const bookmark of snapshot.bookmarks) {
    const details = folderDetails.get(bookmark.folderId);
    if (!details) continue;
    const tags = tagsByBookmark.get(bookmark.id) ?? [];
    documents.push(
      bookmarkDocument(
        documents.length,
        bookmark,
        details.path,
        tags,
        details.bookmarkScopeFolderIds,
      ),
    );
  }
  return documents;
};

const bookmarkDocument = (
  documentId: number,
  bookmark: Bookmark,
  folderPath: string,
  tags: string[],
  scopeFolderIds: readonly string[],
): SearchDocument => ({
  kind: 'bookmark',
  documentId,
  id: bookmark.id,
  title: bookmark.title,
  folderId: bookmark.folderId,
  folderPath,
  url: bookmark.url,
  note: bookmark.note,
  tags,
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

const contextFor = (
  document: SearchDocument,
  result: SearchResult,
): BookmarkSearchContext | undefined => {
  if (document.kind !== 'bookmark') return undefined;
  const fields = new Set(Object.values(result.match).flat());
  if (fields.has('title')) return undefined;
  const terms = result.terms.map((term) => term.toLocaleLowerCase());
  if (fields.has('tagText')) {
    const tags = document.tags;
    const tag = tags.find((value) =>
      terms.some((term) => value.toLocaleLowerCase().includes(term)),
    );
    return { label: 'Tag', text: tag ?? tags[0] ?? '' };
  }
  if (fields.has('urlText')) {
    const url = document.url;
    try {
      return { label: 'URL', text: new URL(url).hostname };
    } catch {
      return { label: 'URL', text: url };
    }
  }
  if (fields.has('noteText')) {
    return { label: 'Note', text: noteExcerpt(document.note, result.terms) };
  }
  return undefined;
};

const resultFromDocument = (
  document: SearchDocument,
  match?: SearchResult,
): BookmarkSearchResult => {
  if (document.kind === 'folder') {
    return {
      kind: 'folder',
      id: document.id,
      title: document.title,
      folderId: document.folderId,
      folderPath: document.folderPath,
    };
  }
  const context = match ? contextFor(document, match) : undefined;
  return {
    kind: 'bookmark',
    id: document.id,
    title: document.title,
    folderId: document.folderId,
    folderPath: document.folderPath,
    url: document.url,
    note: document.note,
    tags: [...document.tags],
    ...(context ? { context } : {}),
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
      const replacements = documentsFor(snapshot);
      replacement.addAll(replacements);
      index = replacement;
      documents = replacements;
      indexedRevision = snapshot.revision;
    },
    async search(query, filters = EMPTY_BOOKMARK_SEARCH_FILTERS, scopeFolderId = null) {
      const normalized = query.trim();
      const results: BookmarkSearchResult[] = [];
      if (!normalized) {
        if (!bookmarkSearchFiltersActive(filters)) return results;
        for (const document of documents) {
          if (!matchesFilters(document, filters, scopeFolderId)) continue;
          results.push(resultFromDocument(document));
          if (results.length === BOOKMARK_SEARCH_RESULT_LIMIT) break;
        }
        return results;
      }
      for (const match of index.search(normalized)) {
        const document = documents[Number(match.id)];
        if (!document || !matchesFilters(document, filters, scopeFolderId)) continue;
        results.push(resultFromDocument(document, match));
        if (results.length === BOOKMARK_SEARCH_RESULT_LIMIT) break;
      }
      return results;
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
