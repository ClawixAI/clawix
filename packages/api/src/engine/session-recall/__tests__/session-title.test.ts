import { describe, it, expect } from 'vitest';
import { deriveSessionTitle } from '../session-title.js';

const createdAt = new Date('2026-05-20T00:00:00.000Z');

describe('deriveSessionTitle', () => {
  it('uses the stored topic when present', () => {
    const t = deriveSessionTitle({
      storedTopic: 'My renamed convo',
      firstUserMessages: ['hi', 'help me with X'],
      createdAt,
    });
    expect(t).toBe('My renamed convo');
  });

  it('skips a greeting opener and uses the first substantive message', () => {
    const t = deriveSessionTitle({
      storedTopic: null,
      firstUserMessages: ['hi', 'hello there', 'help me redesign the wiki memory system'],
      createdAt,
    });
    expect(t).toBe('help me redesign the wiki memory system');
  });

  it('keeps a short-but-substantive CJK task (not a greeting)', () => {
    const t = deriveSessionTitle({
      storedTopic: null,
      firstUserMessages: ['你好', '帮我修复登录错误'],
      createdAt,
    });
    expect(t).toBe('帮我修复登录错误');
  });

  it('clamps on code points without splitting a surrogate pair', () => {
    // 60 astral emoji; clamp to 100 code points keeps all 60 intact (no "?").
    const emoji = '😀'.repeat(60);
    const t = deriveSessionTitle({
      storedTopic: emoji,
      firstUserMessages: [],
      createdAt,
      maxChars: 100,
    });
    expect([...t]).toHaveLength(60);
    expect(t).not.toContain('?');
  });

  it('trims a long Latin title back to a word boundary', () => {
    const long = 'implement the cross session conversation search feature end to end';
    const t = deriveSessionTitle({
      storedTopic: null,
      firstUserMessages: [long],
      createdAt,
      maxChars: 20,
    });
    expect(t.length).toBeLessThanOrEqual(20);
    expect(t.endsWith(' ')).toBe(false);
    expect(long.startsWith(t)).toBe(true);
  });

  it('falls back to a dated label when every message is a greeting', () => {
    const t = deriveSessionTitle({
      storedTopic: null,
      firstUserMessages: ['hi', 'hey', 'yo'],
      createdAt,
    });
    expect(t).toBe('Session — 2026-05-20');
  });

  it('falls back to a dated label when there are no user messages', () => {
    const t = deriveSessionTitle({ storedTopic: null, firstUserMessages: [], createdAt });
    expect(t).toBe('Session — 2026-05-20');
  });
});
