import type { WikiPageRepository } from '../../../db/wiki-page.repository.js';
import type { WikiLinkRepository } from '../../../db/wiki-link.repository.js';
import type { Tool, ToolResult } from '../../tool.js';

export function createWikiReadTool(
  pages: WikiPageRepository,
  links: WikiLinkRepository,
  userId: string,
): Tool {
  return {
    name: 'wiki_read',
    description:
      'Read the full content of one page. Pass an id or a slug (slugs are stable per owner). ' +
      'Set includeBacklinks:true to also see which pages link to this one.',
    parameters: {
      type: 'object',
      properties: {
        idOrSlug: { type: 'string' },
        includeBacklinks: { type: 'boolean' },
      },
      required: ['idOrSlug'],
    },
    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const idOrSlug = String(params['idOrSlug'] ?? '');
      const includeBacklinks = Boolean(params['includeBacklinks']);
      if (!idOrSlug) return { output: 'idOrSlug is required', isError: true };

      const byId = await pages.findById(idOrSlug);
      const page = byId ?? (await pages.findBySlug(userId, idOrSlug));
      if (!page) return { output: `No page with id or slug "${idOrSlug}"`, isError: true };

      const visible = await pages.findVisibleToUser(userId, { limit: 2000 });
      const isVisible = visible.some((p) => p.id === page.id);
      if (!isVisible) return { output: 'Page not visible to you', isError: true };

      const out: Record<string, unknown> = {
        id: page.id,
        slug: page.slug,
        title: page.title,
        summary: page.summary,
        content: page.content,
        tags: page.tags,
        scope: page.scope,
        isOwned: page.ownerId === userId,
        createdAt: page.createdAt.toISOString(),
        updatedAt: page.updatedAt.toISOString(),
      };

      if (includeBacklinks) {
        const backlinkRows = await links.findBacklinks(page.id);
        const sourceIds = backlinkRows.map((r) => r.fromPageId);
        const sources = await Promise.all(sourceIds.map((id) => pages.findById(id)));
        out['backlinks'] = sources
          .filter((p): p is NonNullable<typeof p> => p !== null)
          .map((p) => ({ id: p.id, slug: p.slug, title: p.title, summary: p.summary }));
      }

      return { output: JSON.stringify(out), isError: false };
    },
  };
}
