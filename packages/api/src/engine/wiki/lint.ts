import type { WikiPageRepository } from '../../db/wiki-page.repository.js';
import type { WikiLinkRepository } from '../../db/wiki-link.repository.js';
import { parseWikiLinks } from './parse-wiki-links.js';

export type LintCheck = 'orphans' | 'missing-summaries' | 'stale-claims' | 'broken-links';

export interface LintFinding {
  pageId: string;
  slug: string;
  title: string;
  finding: LintCheck;
  suggestion: string;
}

const STALE_DAYS = 180;
const STALE_MARKERS: readonly RegExp[] = [/\b20\d{2}\b/, /\bas of \d/i];
export const ALL_CHECKS: readonly LintCheck[] = [
  'orphans',
  'missing-summaries',
  'stale-claims',
  'broken-links',
] as const;

const isDaily = (tags: readonly string[]): boolean => tags.some((t) => t.startsWith('daily:'));

/**
 * Run lint checks on all wiki pages owned by `ownerId`.
 *
 * Shared, extractable logic — used by both `wiki_lint` tool and WikiService.
 *
 * @param pages    WikiPageRepository instance
 * @param links    WikiLinkRepository instance
 * @param ownerId  The owner whose pages are scanned
 * @param requested Which checks to run (subset of ALL_CHECKS)
 * @param maxResults Upper bound on returned findings (clamped to [1, 100])
 */
export async function runLintChecks(
  pages: WikiPageRepository,
  links: WikiLinkRepository,
  ownerId: string,
  requested: readonly LintCheck[],
  maxResults: number,
): Promise<LintFinding[]> {
  const owned = await pages.listOwnedByUser(ownerId, { limit: 5000 });
  const findings: LintFinding[] = [];
  const ownedSlugs = new Set(owned.map((p) => p.slug));

  // Synchronous checks: missing-summaries, stale-claims, broken-links
  for (const p of owned) {
    if (requested.includes('missing-summaries') && (!p.summary || p.summary.trim().length === 0)) {
      findings.push({
        pageId: p.id,
        slug: p.slug,
        title: p.title,
        finding: 'missing-summaries',
        suggestion: 'Add a one-line summary so this page surfaces in the index.',
      });
    }

    if (requested.includes('stale-claims') && !isDaily(p.tags)) {
      const ageMs = Date.now() - p.updatedAt.getTime();
      if (ageMs > STALE_DAYS * 86400_000 && STALE_MARKERS.some((re) => re.test(p.content))) {
        findings.push({
          pageId: p.id,
          slug: p.slug,
          title: p.title,
          finding: 'stale-claims',
          suggestion:
            'Verify this is still current; the page is over 6 months old and contains date-sensitive markers.',
        });
      }
    }

    if (requested.includes('broken-links')) {
      const referenced = parseWikiLinks(p.content);
      for (const brokenSlug of referenced.filter((s) => !ownedSlugs.has(s))) {
        findings.push({
          pageId: p.id,
          slug: p.slug,
          title: p.title,
          finding: 'broken-links',
          suggestion: `Update or remove the broken link to [[${brokenSlug}]].`,
        });
      }
    }
  }

  // Async orphans check (requires a DB call per page)
  if (requested.includes('orphans')) {
    for (const p of owned) {
      if (isDaily(p.tags) || p.scope === 'AMBIENT') continue;
      const backs = await links.findBacklinks(p.id);
      if (backs.length === 0) {
        findings.push({
          pageId: p.id,
          slug: p.slug,
          title: p.title,
          finding: 'orphans',
          suggestion: 'Consider linking from related pages, or delete if no longer useful.',
        });
      }
    }
  }

  return findings.slice(0, maxResults);
}
