import { describe, it, expect } from 'vitest';
import { relativeDay } from '../relative-day.js';

const now = new Date('2026-05-26T12:00:00.000Z');

describe('relativeDay', () => {
  it('returns "today" for the same UTC day', () => {
    expect(relativeDay(new Date('2026-05-26T01:00:00.000Z'), now)).toBe('today');
  });
  it('returns "today" for a future date', () => {
    expect(relativeDay(new Date('2026-05-27T00:00:00.000Z'), now)).toBe('today');
  });
  it('returns "yesterday" for a one-day gap', () => {
    expect(relativeDay(new Date('2026-05-25T23:00:00.000Z'), now)).toBe('yesterday');
  });
  it('returns "N days ago" otherwise', () => {
    expect(relativeDay(new Date('2026-05-20T00:00:00.000Z'), now)).toBe('6 days ago');
  });
});
