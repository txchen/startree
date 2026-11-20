import { describe, expect, it } from 'vitest';
import { bookmarkEditorError } from './bookmark-editor';

describe('Bookmark editor validation', () => {
  const bookmark = { url: 'https://example.com', title: 'Example' };

  it('requires nonblank Folder names and Bookmark titles', () => {
    expect(bookmarkEditorError('folder', { name: '  ' })?.field).toBe('name');
    expect(bookmarkEditorError('folder', { name: ' Reading ' })).toBeUndefined();
    expect(bookmarkEditorError('bookmark', { ...bookmark, title: '  ' })?.field).toBe('title');
  });

  it('accepts HTTP and HTTPS and rejects malformed URLs and other schemes', () => {
    for (const url of ['invalid', 'ftp://example.com', 'mailto:test@example.com', 'javascript:0']) {
      expect(bookmarkEditorError('bookmark', { ...bookmark, url })?.field).toBe('url');
    }
    expect(bookmarkEditorError('bookmark', bookmark)).toBeUndefined();
    expect(
      bookmarkEditorError('bookmark', { ...bookmark, url: 'http://example.com' }),
    ).toBeUndefined();
  });

  it('enforces Tag count and trimmed length', () => {
    const validTag = ` ${'a'.repeat(64)} `;
    expect(
      bookmarkEditorError('bookmark', { ...bookmark, tags: Array(50).fill(validTag) }),
    ).toBeUndefined();
    expect(
      bookmarkEditorError('bookmark', { ...bookmark, tags: Array(51).fill('Tag') })?.field,
    ).toBe('tags');
    expect(bookmarkEditorError('bookmark', { ...bookmark, tags: ['x'.repeat(65)] })?.field).toBe(
      'tags',
    );
  });
});
