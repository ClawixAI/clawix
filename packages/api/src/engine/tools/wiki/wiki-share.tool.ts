import type { WikiPageRepository } from '../../../db/wiki-page.repository.js';
import type { WikiShareRepository } from '../../../db/wiki-share.repository.js';
import type { AuditLogRepository } from '../../../db/audit-log.repository.js';
import type { UserRepository } from '../../../db/user.repository.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { Tool, ToolResult } from '../../tool.js';

/**
 * `wiki_share` — share a page you own with a group or the whole organisation.
 *
 * Org sharing is gated to admin role. Group sharing requires the caller to be a
 * member of the target group. Membership is checked via a direct
 * `prisma.groupMember.findFirst` call rather than adding a wiki-specific method
 * to `UserRepository` — keeping `UserRepository` free of wiki concerns while
 * keeping the query to a single line.
 */
export function createWikiShareTool(
  pages: WikiPageRepository,
  shares: WikiShareRepository,
  audit: AuditLogRepository,
  users: UserRepository,
  prisma: PrismaService,
  userId: string,
): Tool {
  return {
    name: 'wiki_share',
    description:
      'Share one of your pages with a group you belong to, or with the whole organization. ' +
      'Org sharing requires admin role.',
    parameters: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        targetType: { type: 'string', enum: ['group', 'org'] },
        groupId: { type: 'string', description: "Required when targetType is 'group'." },
      },
      required: ['pageId', 'targetType'],
    },
    async execute(params): Promise<ToolResult> {
      const pageId = String(params['pageId'] ?? '');
      const targetType = params['targetType'] as 'group' | 'org';
      const groupId = params['groupId'] as string | undefined;

      const page = await pages.findById(pageId);
      if (!page || page.ownerId !== userId) {
        return { output: 'Page not found or not yours', isError: true };
      }

      if (targetType === 'org') {
        const me = await users.findById(userId);
        if (!me || me.role !== 'admin') {
          return { output: 'Org sharing requires admin role', isError: true };
        }
        const share = await shares.setOrgShare(pageId, userId);
        await audit.create({
          userId,
          action: 'wiki.share',
          resource: 'wiki_page',
          resourceId: pageId,
          details: { shareId: share.id, targetType: 'ORG' },
        });
        return { output: JSON.stringify({ shareId: share.id, targetType: 'ORG' }), isError: false };
      }

      // targetType === 'group'
      if (!groupId) {
        return { output: "groupId required when targetType is 'group'", isError: true };
      }

      const membership = await prisma.groupMember.findFirst({
        where: { userId, groupId },
      });
      if (!membership) {
        return { output: 'You are not a member of this group', isError: true };
      }

      const share = await shares.setGroupShare(pageId, groupId, userId);
      await audit.create({
        userId,
        action: 'wiki.share',
        resource: 'wiki_page',
        resourceId: pageId,
        details: { shareId: share.id, targetType: 'GROUP', groupId },
      });
      return {
        output: JSON.stringify({ shareId: share.id, targetType: 'GROUP', groupId }),
        isError: false,
      };
    },
  };
}
