import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { Tool, ToolResult } from '../../tool.js';

/**
 * `wiki_log` — query the AuditLog for wiki.* actions belonging to the caller.
 *
 * Output shape uses `resourceId` (the actual column name) rather than
 * normalising to `targetId`, keeping the data faithful to the DB row.
 */
export function createWikiLogTool(prisma: PrismaService, userId: string): Tool {
  return {
    name: 'wiki_log',
    description:
      'Look at recent wiki activity — your own and (if visible) shared pages you can see — for the ' +
      'last N days. Useful for "what did I work on yesterday" or "what\'s been added to the org wiki this week".',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: 'Default 7, max 90.' },
        action: {
          type: 'string',
          enum: ['create', 'update', 'delete', 'share', 'unshare'],
        },
        limit: { type: 'integer', description: 'Default 50, max 200.' },
      },
    },
    async execute(params): Promise<ToolResult> {
      const days = Math.min(Math.max(Number(params['days'] ?? 7), 1), 90);
      const limit = Math.min(Math.max(Number(params['limit'] ?? 50), 1), 200);
      const action = params['action'] as string | undefined;
      const sinceDate = new Date(Date.now() - days * 86400_000);

      const where: Record<string, unknown> = {
        userId,
        action: action ? `wiki.${action}` : { startsWith: 'wiki.' },
        createdAt: { gte: sinceDate },
      };

      const rows = await prisma.auditLog.findMany({
        where: where as never,
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return {
        output: JSON.stringify(
          rows.map((r) => ({
            id: r.id,
            action: r.action,
            resourceId: r.resourceId,
            details: r.details,
            createdAt: r.createdAt.toISOString(),
          })),
        ),
        isError: false,
      };
    },
  };
}
