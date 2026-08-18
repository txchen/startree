import type { BookmarkSnapshot } from '../../shared/bookmarks/contracts';
import type {
  BookmarkNavigation,
  BookmarkRemoteAdapter,
  BookmarkStorageAdapter,
} from './bookmark-state';

export type MemoryBookmarkRemoteAdapter = BookmarkRemoteAdapter & {
  readonly requestedRevisions: Array<number | null>;
  setSnapshot(snapshot: BookmarkSnapshot): void;
};

export const createMemoryBookmarkRemoteAdapter = (
  initialSnapshot: BookmarkSnapshot,
): MemoryBookmarkRemoteAdapter => {
  let snapshot = structuredClone(initialSnapshot);
  const requestedRevisions: Array<number | null> = [];
  return {
    requestedRevisions,
    async readSnapshot(revision) {
      requestedRevisions.push(revision);
      return revision === snapshot.revision ? null : structuredClone(snapshot);
    },
    setSnapshot(replacement) {
      snapshot = structuredClone(replacement);
    },
  };
};

export const createMemoryBookmarkStorageAdapter = (initial?: {
  snapshot?: BookmarkSnapshot;
  navigation?: BookmarkNavigation;
}): BookmarkStorageAdapter => {
  let snapshot = initial?.snapshot ? structuredClone(initial.snapshot) : null;
  let navigation = initial?.navigation ? structuredClone(initial.navigation) : null;
  return {
    async readSnapshot() {
      return snapshot ? structuredClone(snapshot) : null;
    },
    async writeSnapshot(replacement) {
      snapshot = structuredClone(replacement);
    },
    async readNavigation() {
      return navigation ? structuredClone(navigation) : null;
    },
    async writeNavigation(replacement) {
      navigation = structuredClone(replacement);
    },
  };
};
