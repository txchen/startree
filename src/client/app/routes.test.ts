import { describe, expect, it } from 'vitest';

import { resolvePagePath } from './routes';

describe('Page paths', () => {
  it.each(['/', '/bookmarks', '/bookmarks/', '/BOOKMARKS'])(
    'opens the retained selection at %s',
    (path) => {
      expect(resolvePagePath(path)).toEqual({ matched: true });
    },
  );

  it('retains legacy Folder identifiers for migration to local navigation', () => {
    expect(resolvePagePath('/bookmarks/folder-id')).toEqual({
      matched: true,
      folderId: 'folder-id',
    });
    expect(resolvePagePath('/bookmarks/folder-id/')).toEqual({
      matched: true,
      folderId: 'folder-id',
    });
    expect(resolvePagePath('/bookmarks/folder%20id')).toEqual({
      matched: true,
      folderId: 'folder id',
    });
  });

  it('passes malformed legacy identifiers through to the missing Folder view', () => {
    expect(resolvePagePath('/bookmarks/%invalid')).toEqual({ matched: true, folderId: '%invalid' });
    expect(resolvePagePath('/bookmarks/a/b')).toEqual({ matched: true, folderId: 'a/b' });
  });

  it('does not render the library for unrelated paths', () => {
    expect(resolvePagePath('/unknown')).toEqual({ matched: false });
    expect(resolvePagePath('/bookmarks-extra')).toEqual({ matched: false });
  });
});
