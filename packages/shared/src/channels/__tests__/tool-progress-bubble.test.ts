import { describe, expect, it } from 'vitest';

import { formatToolBubble, type BubbleState } from '../tool-progress-bubble.js';

function freshState(): BubbleState {
  return { lastToolName: null };
}

describe('formatToolBubble — off mode', () => {
  it('returns null regardless of input', () => {
    expect(
      formatToolBubble({ name: 'web_search', args: { q: 'x' } }, 'off', freshState()),
    ).toBeNull();
  });
});

describe('formatToolBubble — all mode', () => {
  it('includes emoji, tool name, and a quoted preview of the first string arg', () => {
    const out = formatToolBubble(
      { name: 'web_search', args: { query: 'hello world' } },
      'all',
      freshState(),
    );
    expect(out).toBe('🔍 web_search: "hello world"');
  });

  it('falls back to ellipsis form when no string args exist', () => {
    const out = formatToolBubble({ name: 'web_search', args: { count: 5 } }, 'all', freshState());
    expect(out).toBe('🔍 web_search…');
  });

  it('truncates previews longer than 40 chars with an ellipsis', () => {
    const long = 'a'.repeat(60);
    const out = formatToolBubble(
      { name: 'web_search', args: { query: long } },
      'all',
      freshState(),
    );
    expect(out).toMatch(/^🔍 web_search: "a{39}…"$/);
  });

  it('uses default cog emoji for unknown tools', () => {
    const out = formatToolBubble({ name: 'mystery_tool', args: {} }, 'all', freshState());
    expect(out).toBe('⚙️ mystery_tool…');
  });
});

describe('formatToolBubble — new mode', () => {
  it('emits the first call', () => {
    const state = freshState();
    expect(formatToolBubble({ name: 'web_search', args: { q: 'a' } }, 'new', state)).not.toBeNull();
  });

  it('suppresses a consecutive call with the same name', () => {
    const state = freshState();
    formatToolBubble({ name: 'web_search', args: { q: 'a' } }, 'new', state);
    const second = formatToolBubble({ name: 'web_search', args: { q: 'b' } }, 'new', state);
    expect(second).toBeNull();
  });

  it('emits when the tool name changes', () => {
    const state = freshState();
    formatToolBubble({ name: 'web_search', args: { q: 'a' } }, 'new', state);
    const next = formatToolBubble({ name: 'web_fetch', args: { url: 'u' } }, 'new', state);
    expect(next).not.toBeNull();
  });
});

describe('formatToolBubble — verbose mode', () => {
  it('JSON-encodes all args without truncation', () => {
    const out = formatToolBubble(
      { name: 'web_search', args: { query: 'x'.repeat(100), max: 5 } },
      'verbose',
      freshState(),
    );
    expect(out).toBe(`🔍 web_search({"query":"${'x'.repeat(100)}","max":5})`);
  });

  it('falls back to "[unserializable]" on circular args without throwing', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const out = formatToolBubble({ name: 'web_search', args: circular }, 'verbose', freshState());
    expect(out).toBe('🔍 web_search([unserializable])');
  });
});
