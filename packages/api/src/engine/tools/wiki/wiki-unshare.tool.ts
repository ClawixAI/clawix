import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { WikiPageRepository } from '../../../db/wiki-page.repository.js';
import type { WikiShareRepository } from '../../../db/wiki-share.repository.js';
import type { AuditLogRepository } from '../../../db/audit-log.repository.js';
import type { Tool, ToolResult } from '../../tool.js';

/**
 * `wiki_unshare` — revoke a share you previously created on one of your pages.
 *
 * The share row is looked up directly via `prisma.wikiShare.findUnique` so we
 * can confirm page ownership before touching anything. `WikiShareRepository`
 * already exposes `revokeShareById`; we don't need a separate repo method.
 */
export function createWikiUnshareTool(
  prisma: PrismaService,
  pages: WikiPageRepository,
  shares: WikiShareRepository,
  audit: AuditLogRepository,
  userId: string,
): Tool {
  return {
    name: 'wiki_unshare',
    description: 'Revoke a share you previously created on one of your pages.',
    parameters: {
      type: 'object',
      properties: { shareId: { type: 'string' } },
      required: ['shareId'],
    },
    async execute(params): Promise<ToolResult> {
      const shareId = String(params['shareId'] ?? '');

      const share = await prisma.wikiShare.findUnique({ where: { id: shareId } });
      if (!share) return { output: 'No such share', isError: true };

      const page = await pages.findById(share.pageId);
      if (!page || page.ownerId !== userId) {
        return { output: 'Page not yours', isError: true };
      }

      const ok = await shares.revokeShareById(shareId);
      if (!ok) return { output: 'Share already revoked', isError: true };

      await audit.create({
        userId,
        action: 'wiki.unshare',
        resource: 'wiki_page',
        resourceId: page.id,
        details: { shareId, targetType: share.targetType, groupId: share.groupId },
      });

      return { output: JSON.stringify({ revoked: true, shareId }), isError: false };
    },
  };
}
