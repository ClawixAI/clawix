import { describe, it, expect } from 'vitest';
import { parseWikiLinks } from '../parse-wiki-links.js';

describe('parseWikiLinks', () => {
  it('extracts unique [[slug]] markers', () => {
    expect(parseWikiLinks('see [[leave-policy]] and [[onboarding]] and [[leave-policy]]')).toEqual([
      'leave-policy',
      'onboarding',
    ]);
  });
  it('ignores invalid markers', () => {
    expect(parseWikiLinks('look at [[]] and [[Bad Slug]] and [[good-slug]]')).toEqual([
      'good-slug',
    ]);
  });
  it('returns empty for content with no markers', () => {
    expect(parseWikiLinks('plain text')).toEqual([]);
  });
  it('supports underscore-prefixed slugs (e.g. _schema)', () => {
    expect(parseWikiLinks('see [[_schema]]')).toEqual(['_schema']);
  });
});
