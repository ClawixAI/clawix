import type { WikiPageRepository } from '../../../db/wiki-page.repository.js';
import type { Tool, ToolResult } from '../../tool.js';

export function createWikiIndexTool(repo: WikiPageRepository, userId: string): Tool {
  return {
    name: 'wiki_index',
    description:
      'Get the wiki table of contents — title + summary + id for every page you can see. ' +
      'Call this first when looking for something — the catalog is current and cheap, and lets ' +
      'you pick a page by name rather than guessing keywords. Filter by `tags` to scope to a ' +
      'domain (e.g. tags:["domain:hr"]).',
    parameters: {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to pages carrying all of these tags.',
        },
        scope: {
          type: 'string',
          enum: ['AMBIENT', 'ARCHIVED'],
          description: 'Filter by page scope.',
        },
        ownership: {
          type: 'string',
          enum: ['mine', 'visible'],
          description: "Default 'visible'.",
        },
        limit: {
          type: 'integer',
          description: 'Default 50, max 200.',
        },
      },
    },
    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const tags = (params['tags'] as string[] | undefined) ?? undefined;
      const scope = params['scope'] as 'AMBIENT' | 'ARCHIVED' | undefined;
      const ownership = (params['ownership'] as 'mine' | 'visible' | undefined) ?? 'visible';
      const rawLimit = Number(params['limit'] ?? 50);
      const limit = Math.min(Math.max(rawLimit, 1), 200);

      const rows =
        ownership === 'mine'
          ? await repo.listOwnedByUser(userId, { tags, scope, limit })
          : await repo.findVisibleToUser(userId, { tags, scope, limit });

      const out = rows.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        summary: p.summary,
        tags: p.tags,
        scope: p.scope,
        isOwned: p.ownerId === userId,
        updatedAt: p.updatedAt.toISOString(),
      }));
      return { output: JSON.stringify(out), isError: false };
    },
  };
}
