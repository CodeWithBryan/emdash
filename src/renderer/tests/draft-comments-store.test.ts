import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftCommentsStore } from '@renderer/features/tasks/diff-view/stores/draft-comments-store';

describe('DraftCommentsStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '11111111-1111-1111-1111-111111111111'
    );
  });

  it('consumes the current formatted comments and clears the store', () => {
    const store = new DraftCommentsStore('task-1');

    store.addComment({
      filePath: 'src/example.ts',
      startLineNumber: 12,
      endLineNumber: 12,
      lineContent: 'const value = 1;',
      content: 'Rename this to be clearer.',
    });

    const formatted = store.consumeAll();

    expect(formatted).toContain('<user_comments>');
    expect(formatted).toContain('src/example.ts');
    expect(formatted).toContain('line="12"');
    expect(formatted).toContain('Rename this to be clearer.');
    expect(store.count).toBe(0);
    expect(store.comments).toEqual([]);
    expect(store.formattedForAgent).toBe('');
  });

  it('formats multi-line ranges with lines="start-end"', () => {
    const store = new DraftCommentsStore('task-1');

    store.addComment({
      filePath: 'src/example.ts',
      startLineNumber: 42,
      endLineNumber: 45,
      lineContent: 'a\nb\nc\nd',
      content: 'Refactor this block.',
    });

    expect(store.formattedForAgent).toContain('lines="42-45"');
    expect(store.formattedForAgent).toContain('Refactor this block.');
  });

  it('normalizes reversed start/end inputs', () => {
    const store = new DraftCommentsStore('task-1');

    store.addComment({
      filePath: 'src/example.ts',
      startLineNumber: 50,
      endLineNumber: 47,
      content: 'oops',
    });

    const [comment] = store.comments;
    expect(comment.startLineNumber).toBe(47);
    expect(comment.endLineNumber).toBe(50);
  });
});
