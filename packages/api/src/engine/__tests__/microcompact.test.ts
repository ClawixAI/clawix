import { describe, it, expect } from 'vitest';
import { microcompactMessages } from '../microcompact.js';

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'user',
    content: 'Hello world',
    toolCallId: null,
    toolCalls: null,
    ordering: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('microcompactMessages', () => {
  it('returns messages unchanged when all content is short', () => {
    const messages = [
      makeMessage({ role: 'user', content: 'Short content' }),
      makeMessage({ id: 'msg-2', role: 'assistant', content: 'Short reply', ordering: 2 }),
      makeMessage({ id: 'msg-3', role: 'tool', content: 'Small result', ordering: 3 }),
    ];
    const result = microcompactMessages(messages);
    expect(result).toHaveLength(3);
    expect(result[0]?.content).toBe('Short content');
    expect(result[1]?.content).toBe('Short reply');
    expect(result[2]?.content).toBe('Small result');
  });

  it('truncates tool role messages with content exceeding 500 chars', () => {
    const longContent = 'x'.repeat(501);
    const msg = makeMessage({ role: 'tool', content: longContent });
    const result = microcompactMessages([msg]);
    expect(result).toHaveLength(1);
    expect(result[0]?.content).toBe(
      `[tool result truncated - originally ${longContent.length} chars]`,
    );
  });

  it('preserves tool role messages with content under 500 chars', () => {
    const content = 'x'.repeat(500);
    const msg = makeMessage({ role: 'tool', content });
    const result = microcompactMessages([msg]);
    expect(result[0]?.content).toBe(content);
  });

  it('does not truncate user or assistant messages regardless of length', () => {
    const longContent = 'x'.repeat(1000);
    const userMsg = makeMessage({ role: 'user', content: longContent });
    const assistantMsg = makeMessage({
      id: 'msg-2',
      role: 'assistant',
      content: longContent,
      ordering: 2,
    });
    const result = microcompactMessages([userMsg, assistantMsg]);
    expect(result[0]?.content).toBe(longContent);
    expect(result[1]?.content).toBe(longContent);
  });

  it('truncates system role messages with content exceeding 500 chars', () => {
    const longContent = 'y'.repeat(600);
    const msg = makeMessage({ role: 'system', content: longContent });
    const result = microcompactMessages([msg]);
    expect(result[0]?.content).toBe(
      `[system message truncated - originally ${longContent.length} chars]`,
    );
  });

  it('returns new objects without mutating originals', () => {
    const longContent = 'z'.repeat(501);
    const original = makeMessage({ role: 'tool', content: longContent });
    const originalContent = original.content;
    const result = microcompactMessages([original]);
    // Original object is not mutated
    expect(original.content).toBe(originalContent);
    // Result is a different object reference
    expect(result[0]).not.toBe(original);
  });

  it('handles empty array', () => {
    const result = microcompactMessages([]);
    expect(result).toHaveLength(0);
    expect(Array.isArray(result)).toBe(true);
  });

  it('handles mixed messages — only truncates eligible ones', () => {
    const longContent = 'a'.repeat(600);
    const shortContent = 'b'.repeat(100);
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content: longContent, ordering: 1 }),
      makeMessage({ id: 'msg-2', role: 'tool', content: longContent, ordering: 2 }),
      makeMessage({ id: 'msg-3', role: 'tool', content: shortContent, ordering: 3 }),
      makeMessage({ id: 'msg-4', role: 'assistant', content: longContent, ordering: 4 }),
      makeMessage({ id: 'msg-5', role: 'system', content: longContent, ordering: 5 }),
    ];
    const result = microcompactMessages(messages);
    // user: not truncated
    expect(result[0]?.content).toBe(longContent);
    // tool (long): truncated
    expect(result[1]?.content).toBe(
      `[tool result truncated - originally ${longContent.length} chars]`,
    );
    // tool (short): not truncated
    expect(result[2]?.content).toBe(shortContent);
    // assistant: not truncated
    expect(result[3]?.content).toBe(longContent);
    // system (long): truncated
    expect(result[4]?.content).toBe(
      `[system message truncated - originally ${longContent.length} chars]`,
    );
  });
});
