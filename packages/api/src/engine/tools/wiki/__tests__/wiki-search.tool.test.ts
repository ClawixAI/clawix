import { describe, it, expect, vi } from 'vitest';
import { createWikiSearchTool } from '../wiki-search.tool.js';
import type { WikiSearchRepository, WikiSearchHit } from '../../../../db/wiki-search.repository.js';

const NOW = new Date('2026-05-17T00:00:00.000Z');

function makeHit(overrides: Partial<WikiSearchHit> = {}): WikiSearchHit {
  return {
    id: 'p1',
    slug: 'test-page',
    title: 'Test Page',
    summary: 'A test page summary',
    snippet: 'a snip of content',
    tags: ['domain:eng'],
    score: 1.2,
    isOwned: true,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('wiki_search tool', () => {
  describe('input validation', () => {
    it('rejects missing query', async () => {
      const fakeRepo = { search: vi.fn().mockResolvedValue([]) } as unknown as WikiSearchRepository;
      const tool = createWikiSearchTool(fakeRepo, 'u1');

      const res = await tool.execute({});

      expect(res.isError).toBe(true);
      expect(res.output).toBe('query is required');
      expect(fakeRepo.search).not.toHaveBeenCalled();
    });

    it('rejects blank query (whitespace only)', async () => {
      const fakeRepo = { search: vi.fn().mockResolvedValue([]) } as unknown as WikiSearchRepository;
      const tool = createWikiSearchTool(fakeRepo, 'u1');

      const res = await tool.execute({ query: '   ' });

      expect(res.isError).toBe(true);
      expect(fakeRepo.search).not.toHaveBeenCalled();
    });
  });

  describe('successful search', () => {
    it('returns top hits as JSON', async () => {
      const hit = makeHit();
      const fakeRepo = {
        search: vi.fn().mockResolvedValue([hit]),
      } as unknown as WikiSearchRepository;
      const tool = createWikiSearchTool(fakeRepo, 'u1');

      const res = await tool.execute({ query: 'test' });

      expect(res.isError).toBe(false);
      const parsed = JSON.parse(res.output);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({
        id: 'p1',
        slug: 'test-page',
        title: 'Test Page',
        summary: 'A test page summary',
        snippet: 'a snip of content',
        tags: ['domain:eng'],
        score: 1.2,
        isOwned: true,
        updatedAt: NOW.toISOString(),
      });
    });

    it('returns empty array JSON when no hits', async () => {
      const fakeRepo = {
        search: vi.fn().mockResolvedValue([]),
      } as unknown as WikiSearchRepository;
      const tool = createWikiSearchTool(fakeRepo, 'u1');

      const res = await tool.execute({ query: 'anything' });

      expect(res.isError).toBe(false);
      expect(JSON.parse(res.output)).toEqual([]);
    });
  });

  describe('parameter forwarding', () => {
    it('clamps limit to max 30', async () => {
      const fakeRepo = {
        search: vi.fn().mockResolvedValue([]),
      } as unknown as WikiSearchRepository;
      const tool = createWikiSearchTool(fakeRepo, 'u1');

      await tool.execute({ query: 'x', limit: 9999 });

      expect(fakeRepo.search).toHaveBeenCalledWith(expect.objectContaining({ limit: 30 }));
    });

    it('clamps limit to min 1', async () => {
      const fakeRepo = {
        search: vi.fn().mockResolvedValue([]),
      } as unknown as WikiSearchRepository;
      const tool = createWikiSearchTool(fakeRepo, 'u1');

      await tool.execute({ query: 'x', limit: -5 });

      expect(fakeRepo.search).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
    });

    it('defaults ownership to "visible"', async () => {
      const fakeRepo = {
        search: vi.fn().mockResolvedValue([]),
      } as unknown as WikiSearchRepository;
      const tool = createWikiSearchTool(fakeRepo, 'u1');

      await tool.execute({ query: 'x' });

      expect(fakeRepo.search).toHaveBeenCalledWith(
        expect.objectContaining({ ownership: 'visible' }),
      );
    });

    it('forwards ownership "mine" correctly', async () => {
      const fakeRepo = {
        search: vi.fn().mockResolvedValue([]),
      } as unknown as WikiSearchRepository;
      const tool = createWikiSearchTool(fakeRepo, 'u1');

      await tool.execute({ query: 'x', ownership: 'mine' });

      expect(fakeRepo.search).toHaveBeenCalledWith(expect.objectContaining({ ownership: 'mine' }));
    });

    it('falls back to "visible" for unknown ownership value', async () => {
      const fakeRepo = {
        search: vi.fn().mockResolvedValue([]),
      } as unknown as WikiSearchRepository;
      const tool = createWikiSearchTool(fakeRepo, 'u1');

      await tool.execute({ query: 'x', ownership: 'all' });

      expect(fakeRepo.search).toHaveBeenCalledWith(
        expect.objectContaining({ ownership: 'visible' }),
      );
    });

    it('forwards tags array', async () => {
      const fakeRepo = {
        search: vi.fn().mockResolvedValue([]),
      } as unknown as WikiSearchRepository;
      const tool = createWikiSearchTool(fakeRepo, 'u1');

      await tool.execute({ query: 'x', tags: ['domain:hr', 'kind:policy'] });

      expect(fakeRepo.search).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ['domain:hr', 'kind:policy'] }),
      );
    });

    it('passes userId from closure to search', async () => {
      const fakeRepo = {
        search: vi.fn().mockResolvedValue([]),
      } as unknown as WikiSearchRepository;
      const tool = createWikiSearchTool(fakeRepo, 'user-xyz');

      await tool.execute({ query: 'x' });

      expect(fakeRepo.search).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-xyz' }));
    });
  });
});
