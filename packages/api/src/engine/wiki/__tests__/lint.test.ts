import { describe, it, expect } from 'vitest';
import { runLintChecks, ALL_CHECKS, type LintCheck } from '../lint.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

interface FakePage {
  id: string;
  slug: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  scope: 'AMBIENT' | 'ARCHIVED';
  ownerId: string;
  updatedAt: Date;
}

function page(overrides: Partial<FakePage> = {}): FakePage {
  return {
    id: 'p',
    slug: 'p',
    title: 'P',
    summary: 'summary',
    content: 'content',
    tags: [],
    scope: 'ARCHIVED',
    ownerId: 'u1',
    updatedAt: new Date('2026-05-18T00:00:00Z'),
    ...overrides,
  };
}

function pagesRepo(rows: FakePage[]) {
  return {
    listOwnedByUser: async (ownerId: string) => rows.filter((p) => p.ownerId === ownerId),
  };
}

function linksRepo(backlinks: Record<string, unknown[]> = {}) {
  return {
    findBacklinks: async (pageId: string) => backlinks[pageId] ?? [],
  };
}

const ALL: readonly LintCheck[] = ALL_CHECKS;
const STALE_DATE = new Date('2025-01-01T00:00:00Z'); // > 180 days before 2026-05-18

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runLintChecks', () => {
  describe('missing-summaries', () => {
    it('flags pages with empty or whitespace-only summary', async () => {
      const pages = pagesRepo([
        page({ id: 'p1', slug: 'no-summary', summary: '' }),
        page({ id: 'p2', slug: 'whitespace', summary: '   ' }),
        page({ id: 'p3', slug: 'good', summary: 'has one' }),
      ]);
      const findings = await runLintChecks(
        pages as never,
        linksRepo() as never,
        'u1',
        ['missing-summaries'],
        100,
      );
      const slugs = findings.filter((f) => f.finding === 'missing-summaries').map((f) => f.slug);
      expect(slugs.sort()).toEqual(['no-summary', 'whitespace']);
    });
  });

  describe('stale-claims', () => {
    it('flags pages older than 180 days that contain date-like markers', async () => {
      const pages = pagesRepo([
        page({
          id: 'p1',
          slug: 'stale-year',
          content: 'As reported in 2023, this was current.',
          updatedAt: STALE_DATE,
        }),
        page({
          id: 'p2',
          slug: 'stale-as-of',
          content: 'As of 2024-01, see report.',
          updatedAt: STALE_DATE,
        }),
        page({
          id: 'p3',
          slug: 'fresh',
          content: 'As reported in 2026.',
          updatedAt: new Date('2026-05-01T00:00:00Z'),
        }),
        page({
          id: 'p4',
          slug: 'no-markers',
          content: 'No dates here at all.',
          updatedAt: STALE_DATE,
        }),
      ]);
      const findings = await runLintChecks(
        pages as never,
        linksRepo() as never,
        'u1',
        ['stale-claims'],
        100,
      );
      const slugs = findings.filter((f) => f.finding === 'stale-claims').map((f) => f.slug);
      expect(slugs.sort()).toEqual(['stale-as-of', 'stale-year']);
    });

    it('does not flag daily-tagged pages even when old + date-marked', async () => {
      const pages = pagesRepo([
        page({
          id: 'p1',
          slug: 'daily',
          tags: ['daily:2024-12-01'],
          content: '2023 update',
          updatedAt: STALE_DATE,
        }),
      ]);
      const findings = await runLintChecks(
        pages as never,
        linksRepo() as never,
        'u1',
        ['stale-claims'],
        100,
      );
      expect(findings).toHaveLength(0);
    });
  });

  describe('broken-links', () => {
    it('flags [[slug]] markers that do not resolve to an owned page', async () => {
      const pages = pagesRepo([
        page({
          id: 'p1',
          slug: 'src',
          content: 'see [[exists]] and [[missing]] and [[also-missing]]',
        }),
        page({ id: 'p2', slug: 'exists' }),
      ]);
      const findings = await runLintChecks(
        pages as never,
        linksRepo() as never,
        'u1',
        ['broken-links'],
        100,
      );
      const brokenSlugs = findings
        .filter((f) => f.finding === 'broken-links')
        .map((f) => f.suggestion);
      expect(brokenSlugs.some((s) => s.includes('[[missing]]'))).toBe(true);
      expect(brokenSlugs.some((s) => s.includes('[[also-missing]]'))).toBe(true);
      expect(brokenSlugs.some((s) => s.includes('[[exists]]'))).toBe(false);
    });
  });

  describe('orphans', () => {
    it('flags archived non-daily pages with zero backlinks', async () => {
      const pages = pagesRepo([
        page({ id: 'orphan-id', slug: 'orphan' }),
        page({ id: 'linked-id', slug: 'linked' }),
      ]);
      const findings = await runLintChecks(
        pages as never,
        linksRepo({
          'linked-id': [{ id: 'l1', fromPageId: 'orphan-id', toPageId: 'linked-id' }],
        }) as never,
        'u1',
        ['orphans'],
        100,
      );
      const slugs = findings.filter((f) => f.finding === 'orphans').map((f) => f.slug);
      expect(slugs).toEqual(['orphan']);
    });

    it('does not flag ambient or daily pages as orphans', async () => {
      const pages = pagesRepo([
        page({ id: 'p1', slug: 'pinned', scope: 'AMBIENT' }),
        page({ id: 'p2', slug: 'today', tags: ['daily:2026-05-18'] }),
      ]);
      const findings = await runLintChecks(
        pages as never,
        linksRepo() as never,
        'u1',
        ['orphans'],
        100,
      );
      expect(findings).toHaveLength(0);
    });
  });

  describe('maxResults clamping', () => {
    it('caps the returned list at maxResults', async () => {
      const rows = Array.from({ length: 50 }, (_, i) => page({ id: `p${i}`, slug: `orphan-${i}` }));
      const pages = pagesRepo(rows);
      const findings = await runLintChecks(
        pages as never,
        linksRepo() as never,
        'u1',
        ['orphans'],
        7,
      );
      expect(findings).toHaveLength(7);
    });
  });

  describe('ALL_CHECKS', () => {
    it('exports the four check ids in a stable order', () => {
      expect([...ALL]).toEqual(['orphans', 'missing-summaries', 'stale-claims', 'broken-links']);
    });
  });
});
