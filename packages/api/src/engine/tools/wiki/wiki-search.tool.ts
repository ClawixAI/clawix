import type { WikiSearchRepository } from '../../../db/wiki-search.repository.js';
import type { Tool, ToolResult } from '../../tool.js';

/**
 * Wrapper tool that exposes WikiSearchRepository.search() to the agent loop.
 *
 * Validates and clamps inputs, then delegates to the repository's hybrid
 * tsvector + pg_trgm SQL query.
 */
export function createWikiSearchTool(repo: WikiSearchRepository, userId: string): Tool {
  return {
    name: 'wiki_search',
    description:
      'Search visible wiki pages by free text. Returns top matches with a snippet. ' +
      "Use this when the wiki index doesn't surface what you need — for example a specific " +
      "phrase, or when you can't remember the page name. Combine with `tags` to scope results.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Free-text query (required).',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Pre-filter to pages that carry ALL of these tags.',
        },
        ownership: {
          type: 'string',
          enum: ['mine', 'visible'],
          description: '"mine" = only your own pages; "visible" = yours + shared (default).',
        },
        limit: {
          type: 'integer',
          description: 'Max results to return. Default 10, clamped to [1, 30].',
        },
      },
      required: ['query'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const query = String(params['query'] ?? '').trim();
      if (!query) {
        return { output: 'query is required', isError: true };
      }

      const tags = Array.isArray(params['tags'])
        ? (params['tags'] as string[])
        : params['tags'] !== undefined
          ? [String(params['tags'])]
          : undefined;

      const ownershipRaw = params['ownership'];
      const ownership: 'mine' | 'visible' =
        ownershipRaw === 'mine' || ownershipRaw === 'visible' ? ownershipRaw : 'visible';

      const rawLimit = Number(params['limit'] ?? 10);
      const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 10, 1), 30);

      const hits = await repo.search({ userId, query, tags, ownership, limit });

      return {
        output: JSON.stringify(
          hits.map((h) => ({
            id: h.id,
            slug: h.slug,
            title: h.title,
            summary: h.summary,
            snippet: h.snippet,
            tags: h.tags,
            score: h.score,
            isOwned: h.isOwned,
            updatedAt: h.updatedAt.toISOString(),
          })),
        ),
        isError: false,
      };
    },
  };
}
