import type { SessionSearchService } from '../../session-recall/session-search.service.js';
import type { Tool, ToolResult } from '../../tool.js';

/**
 * Lets the agent search its OWN past conversations (across sessions).
 * userId is captured from the closure — never read from params/ctx.
 */
export function createSessionSearchTool(service: SessionSearchService, userId: string): Tool {
  return {
    name: 'session_search',
    description:
      'Search your own past conversations (across all your sessions) for what was discussed or ' +
      'done — e.g. "what did I do on the login bug last week" or "where did we leave the wiki ' +
      'redesign". Returns matching excerpts labeled with the conversation title and date. ' +
      'Searches conversation text only (not tool output). For your knowledge base, use wiki_search.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text search query (required).' },
        days: {
          type: 'integer',
          description: 'Only search the last N days. Omit to search all history.',
          minimum: 1,
          maximum: 365,
        },
        limit: {
          type: 'integer',
          description: 'Max excerpts to return. Default 8, clamped to [1, 25].',
          minimum: 1,
          maximum: 25,
        },
      },
      required: ['query'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const query = String(params['query'] ?? '').trim();
      if (!query) return { output: 'query is required', isError: true };

      const rawLimit = Number(params['limit'] ?? 8);
      const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 8, 1), 25);

      const args: { userId: string; query: string; days?: number; limit: number } = {
        userId,
        query,
        limit,
      };
      const rawDays = params['days'];
      if (rawDays !== undefined) {
        const days = Number(rawDays);
        if (Number.isFinite(days) && days >= 1) args.days = Math.min(Math.floor(days), 365);
      }

      const results = await service.search(args);
      return { output: JSON.stringify(results), isError: false };
    },
  };
}
