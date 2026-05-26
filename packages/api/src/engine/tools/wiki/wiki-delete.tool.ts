import type { WikiPageRepository } from '../../../db/wiki-page.repository.js';
import type { WikiLinkRepository } from '../../../db/wiki-link.repository.js';
import type { AuditLogRepository } from '../../../db/audit-log.repository.js';
import type { Tool, ToolResult } from '../../tool.js';

/**
 * `wiki_delete` — owner-only page deletion with audit trail.
 *
 * Callers may only delete pages they own. The Prisma cascade removes WikiLink
 * rows automatically; we additionally call `links.deleteAllForPage` as a
 * belt-and-suspenders guard against orphaned rows.
 */
export function createWikiDeleteTool(
  pages: WikiPageRepository,
  links: WikiLinkRepository,
  audit: AuditLogRepository,
  userId: string,
): Tool {
  return {
    name: 'wiki_delete',
    description:
      'Delete one of your own pages. You cannot delete pages owned by others (use `wiki_unshare` ' +
      'to drop a share). Deletion cascades to incoming links, so referring pages will show ' +
      '[[slug]] markers that no longer resolve — `wiki_lint` flags these as broken links.',
    parameters: {
      type: 'object',
      properties: { pageId: { type: 'string' } },
      required: ['pageId'],
    },
    async execute(params): Promise<ToolResult> {
      const pageId = String(params['pageId'] ?? '');
      if (!pageId) return { output: 'pageId required', isError: true };

      const page = await pages.findById(pageId);
      if (!page) return { output: 'No such page', isError: true };

      const ok = await pages.deleteByOwner(userId, pageId);
      if (!ok) return { output: "You don't own this page", isError: true };

      await links.deleteAllForPage(pageId);

      await audit.create({
        userId,
        action: 'wiki.delete',
        resource: 'wiki_page',
        resourceId: pageId,
        details: { slug: page.slug, title: page.title },
      });

      return { output: JSON.stringify({ deleted: true, pageId }), isError: false };
    },
  };
}
