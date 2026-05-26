import { describe, it, expect } from 'vitest';
import { createWikiReadTool } from '../wiki-read.tool.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

const basePage = {
  id: 'page-1',
  slug: 'hello-world',
  title: 'Hello World',
  summary: 'A greeting page',
  content: '# Hello\n\nWorld content',
  tags: ['domain:eng'],
  scope: 'AMBIENT' as const,
  ownerId: 'u1',
  createdAt: NOW,
  updatedAt: NOW,
};

const otherPage = {
  id: 'page-2',
  slug: 'other-page',
  title: 'Other Page',
  summary: 'Another page',
  content: 'Other content',
  tags: ['domain:hr'],
  scope: 'ARCHIVED' as const,
  ownerId: 'u2',
  createdAt: NOW,
  updatedAt: NOW,
};

function makePageRepo(pages: (typeof basePage)[], visiblePages?: (typeof basePage)[]) {
  const _visible = visiblePages ?? pages;
  return {
    findById: async (pageId: string) => pages.find((p) => p.id === pageId) ?? null,
    findBySlug: async (_userId: string, slug: string) => pages.find((p) => p.slug === slug) ?? null,
    findVisibleToUser: async (_userId: string, _opts?: unknown) => _visible,
  };
}

function makeLinkRepo(rows: { id: string; fromPageId: string; toPageId: string }[]) {
  return {
    findBacklinks: async (pageId: string) => rows.filter((r) => r.toPageId === pageId),
  };
}

describe('wiki_read tool', () => {
  it('reads a page by id', async () => {
    const pageRepo = makePageRepo([basePage]);
    const linkRepo = makeLinkRepo([]);
    const tool = createWikiReadTool(pageRepo as never, linkRepo as never, 'u1');

    const res = await tool.execute({ idOrSlug: 'page-1' });

    expect(res.isError).toBe(false);
    const parsed = JSON.parse(res.output);
    expect(parsed).toMatchObject({
      id: 'page-1',
      slug: 'hello-world',
      title: 'Hello World',
      summary: 'A greeting page',
      content: '# Hello\n\nWorld content',
      tags: ['domain:eng'],
      scope: 'AMBIENT',
      isOwned: true,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    expect(parsed.backlinks).toBeUndefined();
  });

  it('reads a page by slug', async () => {
    const pageRepo = makePageRepo([basePage]);
    const linkRepo = makeLinkRepo([]);
    const tool = createWikiReadTool(pageRepo as never, linkRepo as never, 'u1');

    const res = await tool.execute({ idOrSlug: 'hello-world' });

    expect(res.isError).toBe(false);
    const parsed = JSON.parse(res.output);
    expect(parsed.id).toBe('page-1');
    expect(parsed.slug).toBe('hello-world');
  });

  it('returns isError when the page is not visible to the caller', async () => {
    // basePage exists but is not in the visible set
    const pageRepo = makePageRepo([basePage], []);
    const linkRepo = makeLinkRepo([]);
    const tool = createWikiReadTool(pageRepo as never, linkRepo as never, 'u1');

    const res = await tool.execute({ idOrSlug: 'page-1' });

    expect(res.isError).toBe(true);
    expect(res.output).toBe('Page not visible to you');
  });

  it('returns isError when no page exists for the given id or slug', async () => {
    const pageRepo = makePageRepo([]);
    const linkRepo = makeLinkRepo([]);
    const tool = createWikiReadTool(pageRepo as never, linkRepo as never, 'u1');

    const res = await tool.execute({ idOrSlug: 'nonexistent' });

    expect(res.isError).toBe(true);
    expect(res.output).toBe('No page with id or slug "nonexistent"');
  });

  it('includes backlinks when includeBacklinks is true', async () => {
    const pageRepo = makePageRepo([basePage, otherPage]);
    const linkRows = [{ id: 'link-1', fromPageId: 'page-2', toPageId: 'page-1' }];
    const linkRepo = makeLinkRepo(linkRows);
    const tool = createWikiReadTool(pageRepo as never, linkRepo as never, 'u1');

    const res = await tool.execute({ idOrSlug: 'page-1', includeBacklinks: true });

    expect(res.isError).toBe(false);
    const parsed = JSON.parse(res.output);
    expect(parsed.backlinks).toBeDefined();
    expect(parsed.backlinks).toHaveLength(1);
    expect(parsed.backlinks[0]).toMatchObject({
      id: 'page-2',
      slug: 'other-page',
      title: 'Other Page',
      summary: 'Another page',
    });
  });
});
