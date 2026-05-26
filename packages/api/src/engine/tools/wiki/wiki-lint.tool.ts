import type { WikiPageRepository } from '../../../db/wiki-page.repository.js';
import type { WikiLinkRepository } from '../../../db/wiki-link.repository.js';
import type { AuditLogRepository } from '../../../db/audit-log.repository.js';
import { runLintChecks, ALL_CHECKS, type LintCheck } from '../../wiki/lint.js';
import type { Tool, ToolResult } from '../../tool.js';

/**
 * `wiki_lint` — owner-only maintenance scan.
 *
 * Checks owned pages for: orphans, missing summaries, stale claims, and
 * broken [[slug]] wiki-links. Returns findings only; no auto-fix.
 */
export function createWikiLintTool(
  pages: WikiPageRepository,
  links: WikiLinkRepository,
  audit: AuditLogRepository,
  userId: string,
): Tool {
  return {
    name: 'wiki_lint',
    description:
      'Scan **your own** wiki pages for maintenance issues — orphans, missing summaries, stale claims, ' +
      'broken links. Returns findings only; no auto-fix. You decide what to address. Shared pages ' +
      "and other users' content are not linted.",
    parameters: {
      type: 'object',
      properties: {
        checks: {
          type: 'array',
          items: { type: 'string', enum: ALL_CHECKS },
        },
        maxResults: { type: 'integer', description: 'Default 20, max 100.' },
      },
    },
    async execute(params): Promise<ToolResult> {
      // Resolve and validate checks
      const requestedRaw = (params['checks'] as LintCheck[] | undefined) ?? ALL_CHECKS;
      const requested = requestedRaw.filter((c): c is LintCheck =>
        (ALL_CHECKS as string[]).includes(c),
      );
      const checksToRun: readonly LintCheck[] = requested.length > 0 ? requested : ALL_CHECKS;

      // Clamp maxResults to [1, 100], default 20
      const maxResults = Math.min(Math.max(Number(params['maxResults'] ?? 20), 1), 100);

      const capped = await runLintChecks(pages, links, userId, checksToRun, maxResults);

      await audit.create({
        userId,
        action: 'wiki.lint',
        resource: 'wiki_page',
        resourceId: 'lint-run',
        details: { checks: [...checksToRun], findingsCount: capped.length },
      });

      return { output: JSON.stringify(capped), isError: false };
    },
  };
}
