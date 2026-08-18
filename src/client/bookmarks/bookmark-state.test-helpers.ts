import type { BookmarkSnapshot } from '../../shared/bookmarks/contracts';
import type {
  BookmarkLifecycleAdapter,
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
  synchronizedAt?: string;
  incompatibleWireFormatVersion?: number;
}): BookmarkStorageAdapter => {
  let snapshot = initial?.snapshot ? structuredClone(initial.snapshot) : null;
  let navigation = initial?.navigation ? structuredClone(initial.navigation) : null;
  let synchronizedAt = initial?.synchronizedAt ?? null;
  const incompatibleWireFormatVersion = initial?.incompatibleWireFormatVersion;
  return {
    async readSnapshot() {
      if (incompatibleWireFormatVersion !== undefined) {
        return { status: 'incompatible', wireFormatVersion: incompatibleWireFormatVersion };
      }
      return snapshot
        ? { status: 'compatible', snapshot: structuredClone(snapshot), synchronizedAt }
        : { status: 'empty' };
    },
    async writeSnapshot(replacement, metadata) {
      snapshot = structuredClone(replacement);
      synchronizedAt = metadata.synchronizedAt;
    },
    async readNavigation() {
      return navigation ? structuredClone(navigation) : null;
    },
    async writeNavigation(replacement) {
      navigation = structuredClone(replacement);
    },
    async clear() {
      snapshot = null;
      navigation = null;
    },
  };
};

export const createMemoryBookmarkLifecycleAdapter = (initial?: {
  online?: boolean;
  visible?: boolean;
}): BookmarkLifecycleAdapter & {
  setOnline(online: boolean): void;
  setVisible(visible: boolean): void;
} => {
  let online = initial?.online ?? true;
  let visible = initial?.visible ?? true;
  const listeners = {
    online: new Set<() => void>(),
    offline: new Set<() => void>(),
    visibilitychange: new Set<() => void>(),
  };
  return {
    now: () => Date.now(),
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    setInterval: (callback, delay) => setInterval(callback, delay),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    isOnline: () => online,
    isVisible: () => visible,
    subscribe(event, listener) {
      listeners[event].add(listener);
      return () => listeners[event].delete(listener);
    },
    setOnline(replacement) {
      online = replacement;
      for (const listener of listeners[online ? 'online' : 'offline']) listener();
    },
    setVisible(replacement) {
      visible = replacement;
      for (const listener of listeners.visibilitychange) listener();
    },
  };
};
