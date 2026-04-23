import { describe, expect, it } from 'vitest';

import {
  SAFE_SPLIT_LENGTH,
  TELEGRAM_MAX_MESSAGE_LENGTH,
  splitMessage,
} from '../utils/message-chunker.js';

describe('splitMessage', () => {
  it('exposes Telegram length constants', () => {
    expect(TELEGRAM_MAX_MESSAGE_LENGTH).toBe(4096);
    expect(SAFE_SPLIT_LENGTH).toBe(3500);
  });

  it('returns empty array for empty content', () => {
    expect(splitMessage('', 100)).toEqual([]);
  });

  it('returns single chunk when content fits within limit', () => {
    expect(splitMessage('hello', 100)).toEqual(['hello']);
  });

  it('returns single chunk when content exactly equals limit', () => {
    const text = 'a'.repeat(100);
    expect(splitMessage(text, 100)).toEqual([text]);
  });

  it('returns single chunk for non-positive maxLen', () => {
    expect(splitMessage('hello', 0)).toEqual(['hello']);
    expect(splitMessage('hello', -1)).toEqual(['hello']);
  });

  it('hard-cuts into multiple chunks when no whitespace available', () => {
    const text = 'a'.repeat(250);
    const chunks = splitMessage(text, 100);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toBe('a'.repeat(100));
    expect(chunks[1]).toBe('a'.repeat(100));
    expect(chunks[2]).toBe('a'.repeat(50));
  });

  it('every chunk respects maxLen', () => {
    const text = 'x'.repeat(10_000);
    const chunks = splitMessage(text, 100);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
    expect(chunks.join('')).toBe(text);
  });

  it('prefers the last newline inside the search window', () => {
    // 100-char maxLen, window = 200 but capped by maxLen.
    // Content has a newline at index 80, filler to 150.
    const text = 'a'.repeat(80) + '\n' + 'b'.repeat(70);
    const chunks = splitMessage(text, 100);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe('a'.repeat(80));
    expect(chunks[1]).toBe('b'.repeat(70));
  });

  it('strips leading whitespace from subsequent chunks', () => {
    const text = 'first\n\n\nsecond' + 'x'.repeat(200);
    const chunks = splitMessage(text, 20);

    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startsWith(' ')).toBe(false);
      expect(chunks[i].startsWith('\n')).toBe(false);
    }
  });

  it('falls back to the last space when no newline is in the window', () => {
    // maxLen=50, no newlines at all, space at index 45.
    const text = 'a'.repeat(45) + ' ' + 'b'.repeat(60);
    const chunks = splitMessage(text, 50);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toBe('a'.repeat(45));
    expect(chunks[1]).toBe('b'.repeat(50));
    expect(chunks[2]).toBe('b'.repeat(10));
  });

  it('hard-cuts when neither newline nor space exists in window', () => {
    const text = 'a'.repeat(250);
    const chunks = splitMessage(text, 100);

    expect(chunks[0]).toBe('a'.repeat(100));
    expect(chunks[1]).toBe('a'.repeat(100));
    expect(chunks[2]).toBe('a'.repeat(50));
  });

  it('closes an open code fence at chunk boundary and reopens it', () => {
    // Build content where the split lands inside a ```ts block.
    const header = '```ts\n';
    const body = 'const x = 1;\n'.repeat(30); // 390 chars
    const content = 'intro paragraph\n\n' + header + body + '```\nepilogue';

    const chunks = splitMessage(content, 200);

    expect(chunks.length).toBeGreaterThan(1);

    // First chunk that contains the opening fence must end with a closing fence.
    const firstFenceChunkIdx = chunks.findIndex((c) => c.includes('```ts'));
    expect(firstFenceChunkIdx).toBeGreaterThanOrEqual(0);
    expect(chunks[firstFenceChunkIdx]!.trimEnd().endsWith('```')).toBe(true);

    // Subsequent chunk must reopen with the same language header.
    expect(chunks[firstFenceChunkIdx + 1]!.startsWith('```ts')).toBe(true);
  });

  it('reopens code fence without language when no hint was given', () => {
    const header = '```\n';
    const body = 'x = 1;\n'.repeat(80);
    const content = header + body + '```';

    const chunks = splitMessage(content, 150);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.trimEnd().endsWith('```')).toBe(true);
    expect(chunks[1]!.startsWith('```')).toBe(true);
  });

  it('every chunk has balanced code fences', () => {
    const content =
      '```ts\n' + 'const a = 1;\n'.repeat(50) + '```\n\nprose\n\n' +
      '```python\n' + 'x = 1\n'.repeat(50) + '```';

    const chunks = splitMessage(content, 200);

    for (const chunk of chunks) {
      const fenceCount = (chunk.match(/```/g) ?? []).length;
      expect(fenceCount % 2).toBe(0);
    }
  });

  it('makes progress when fence opens at start with no other newlines in window', { timeout: 3000 }, () => {
    const content = '```ts\n' + 'a'.repeat(500);
    const chunks = splitMessage(content, 200); // must not hang

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(200);
    }
    // All body content is preserved (ignoring injected fences and reopen headers).
    const reconstructed = chunks.join('').replace(/```ts\n|\n```/g, '');
    expect(reconstructed).toContain('a'.repeat(500));
  });

  it('returns empty language when fence header has no trailing newline', () => {
    // Unclosed fence with no newline after the open marker; should not produce
    // a garbage reopen header on the subsequent chunk.
    const content = '```ts no newline here ' + 'x'.repeat(500);
    const chunks = splitMessage(content, 200);

    // Chunks after the first must either reopen with plain ``` or have no reopen
    // header at all — never with a multi-word "language" like ```ts no newline here.
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.startsWith('```ts no')).toBe(false);
    }
  });
});
