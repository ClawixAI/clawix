import { describe, it, expect } from 'vitest';
import { renderRecentSessions } from '../render-recent-sessions.js';

const now = new Date('2026-05-26T12:00:00.000Z');

describe('renderRecentSessions', () => {
  it('returns empty string when there are no sessions', () => {
    expect(renderRecentSessions([], now, 350)).toBe('');
  });

  it('renders a heading and one line per session with relative days', () => {
    const out = renderRecentSessions(
      [
        { title: 'Fix daily-notes injection', createdAt: new Date('2026-05-24T09:00:00.000Z') },
        { title: 'Wiki memory redesign', createdAt: new Date('2026-05-26T08:00:00.000Z') },
      ],
      now,
      350,
    );
    expect(out).toContain('## Recent Sessions');
    expect(out).toContain('- "Fix daily-notes injection" — 2 days ago');
    expect(out).toContain('- "Wiki memory redesign" — today');
  });

  it('says "yesterday" for a one-day gap', () => {
    const out = renderRecentSessions(
      [{ title: 'X', createdAt: new Date('2026-05-25T23:00:00.000Z') }],
      now,
      350,
    );
    expect(out).toContain('- "X" — yesterday');
  });

  it('drops trailing lines that exceed the token budget', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      title: `Session number ${i} with a fairly long descriptive title`,
      createdAt: now,
    }));
    // ~4 chars/token; budget of 20 tokens ≈ 80 chars → only the heading + a
    // couple of lines fit.
    const out = renderRecentSessions(many, now, 20);
    expect(out.length).toBeLessThanOrEqual(20 * 4 + 32); // heading slack
    expect(out).toContain('## Recent Sessions');
  });
});
