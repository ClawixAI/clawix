import { describe, expect, it } from 'vitest';
import { parseView } from '../wiki-tabs';

describe('parseView', () => {
  it('returns "pages" for null', () => {
    expect(parseView(null)).toBe('pages');
  });

  it('returns "pages" for empty string', () => {
    expect(parseView('')).toBe('pages');
  });

  it('returns "pages" for the literal "pages"', () => {
    expect(parseView('pages')).toBe('pages');
  });

  it('returns "graph" for the literal "graph"', () => {
    expect(parseView('graph')).toBe('graph');
  });

  it('returns "schema" for the literal "schema"', () => {
    expect(parseView('schema')).toBe('schema');
  });

  it('falls back to "pages" for unknown values', () => {
    expect(parseView('garbage')).toBe('pages');
    expect(parseView('GRAPH')).toBe('pages');
    expect(parseView('  pages  ')).toBe('pages');
  });
});
