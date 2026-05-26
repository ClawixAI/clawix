import { describe, it, expect } from 'vitest';
import {
  wikiTagSchema,
  wikiSlugSchema,
  createWikiPageSchema,
  updateWikiPageSchema,
  wikiSearchQuerySchema,
  wikiScopeSchema,
  wikiShareTargetSchema,
  wikiIndexQuerySchema,
} from '../wiki.schema.js';

describe('wikiTagSchema', () => {
  it('accepts lowercase alphanumeric + colon + dash, ≤50 chars', () => {
    expect(wikiTagSchema.safeParse('domain:hr').success).toBe(true);
    expect(wikiTagSchema.safeParse('daily:2026-05-17').success).toBe(true);
    expect(wikiTagSchema.safeParse('kind:profile').success).toBe(true);
    expect(wikiTagSchema.safeParse('free-form').success).toBe(true);
  });
  it('rejects uppercase and length >50', () => {
    expect(wikiTagSchema.safeParse('Domain:HR').success).toBe(false);
    expect(wikiTagSchema.safeParse('a'.repeat(51)).success).toBe(false);
  });
  it('rejects tags containing a dot', () => {
    expect(wikiTagSchema.safeParse('domain.with.dot').success).toBe(false);
  });
});

describe('wikiSlugSchema', () => {
  it('accepts lowercase ASCII with dashes', () => {
    expect(wikiSlugSchema.safeParse('leave-policy').success).toBe(true);
    expect(wikiSlugSchema.safeParse('_schema').success).toBe(true);
  });
  it('rejects spaces and uppercase', () => {
    expect(wikiSlugSchema.safeParse('Leave Policy').success).toBe(false);
  });
});

describe('createWikiPageSchema', () => {
  it('requires title, content, and summary', () => {
    const ok = createWikiPageSchema.safeParse({
      title: 'Leave Policy',
      content: 'PTO accrual rules…',
      summary: 'Covers PTO accrual.',
    });
    expect(ok.success).toBe(true);
  });
  it('rejects when summary is missing', () => {
    const bad = createWikiPageSchema.safeParse({
      title: 'Leave Policy',
      content: 'PTO accrual rules…',
    });
    expect(bad.success).toBe(false);
  });
  it('rejects when summary is empty string', () => {
    const bad = createWikiPageSchema.safeParse({
      title: 'Leave Policy',
      content: 'PTO accrual rules…',
      summary: '',
    });
    expect(bad.success).toBe(false);
  });
  it('rejects content > 10000 chars', () => {
    const bad = createWikiPageSchema.safeParse({
      title: 'X',
      content: 'a'.repeat(10001),
      summary: 'A summary.',
    });
    expect(bad.success).toBe(false);
  });
  it('rejects summary > 200 chars', () => {
    const bad = createWikiPageSchema.safeParse({
      title: 'X',
      content: 'y',
      summary: 'a'.repeat(201),
    });
    expect(bad.success).toBe(false);
  });
});

describe('wikiScopeSchema', () => {
  it('accepts AMBIENT and ARCHIVED', () => {
    expect(wikiScopeSchema.safeParse('AMBIENT').success).toBe(true);
    expect(wikiScopeSchema.safeParse('ARCHIVED').success).toBe(true);
    expect(wikiScopeSchema.safeParse('OTHER').success).toBe(false);
  });
});

describe('updateWikiPageSchema', () => {
  it('allows partial updates (all fields optional)', () => {
    expect(updateWikiPageSchema.safeParse({}).success).toBe(true);
    expect(updateWikiPageSchema.safeParse({ title: 'New Title' }).success).toBe(true);
    expect(updateWikiPageSchema.safeParse({ content: 'a'.repeat(10001) }).success).toBe(false);
  });
  it('allows update without summary (summary is optional on update)', () => {
    expect(
      updateWikiPageSchema.safeParse({ title: 'Updated Title', content: 'New content.' }).success,
    ).toBe(true);
  });
});

describe('wikiSearchQuerySchema', () => {
  it('requires query, defaults limit 10', () => {
    const parsed = wikiSearchQuerySchema.parse({ query: 'sql' });
    expect(parsed.limit).toBe(10);
    expect(parsed.ownership).toBe('visible');
  });
  it('clamps limit to 30', () => {
    expect(wikiSearchQuerySchema.safeParse({ query: 'x', limit: 31 }).success).toBe(false);
  });
});

describe('wikiShareTargetSchema', () => {
  it('accepts org target', () => {
    expect(wikiShareTargetSchema.safeParse({ targetType: 'org' }).success).toBe(true);
  });
  it('accepts group target with groupId', () => {
    expect(wikiShareTargetSchema.safeParse({ targetType: 'group', groupId: 'g1' }).success).toBe(
      true,
    );
  });
  it('rejects group target without groupId', () => {
    expect(wikiShareTargetSchema.safeParse({ targetType: 'group' }).success).toBe(false);
  });
  it('rejects unknown targetType', () => {
    expect(wikiShareTargetSchema.safeParse({ targetType: 'other' }).success).toBe(false);
  });
});

describe('wikiIndexQuerySchema', () => {
  it('accepts empty input and applies defaults', () => {
    const parsed = wikiIndexQuerySchema.parse({});
    expect(parsed.ownership).toBe('visible');
    expect(parsed.limit).toBe(50);
  });
  it('accepts ownership=mine and limit=100', () => {
    const parsed = wikiIndexQuerySchema.parse({ ownership: 'mine', limit: 100 });
    expect(parsed.ownership).toBe('mine');
    expect(parsed.limit).toBe(100);
  });
  it('rejects limit > 200', () => {
    expect(wikiIndexQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
  });
  it('accepts valid tags array', () => {
    expect(wikiIndexQuerySchema.safeParse({ tags: ['domain:hr'] }).success).toBe(true);
  });
  it('rejects tags array containing uppercase tag', () => {
    expect(wikiIndexQuerySchema.safeParse({ tags: ['Domain:HR'] }).success).toBe(false);
  });
});
