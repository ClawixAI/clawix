import { describe, it, expect, vi } from 'vitest';
import { createWikiWriteTool } from '../wiki-write.tool.js';
import type { WikiPageRepository } from '../../../../db/wiki-page.repository.js';
import type { WikiLinkRepository } from '../../../../db/wiki-link.repository.js';
import type { AuditLogRepository } from '../../../../db/audit-log.repository.js';
import type { UserRepository } from '../../../../db/user.repository.js';
import type { PolicyRepository } from '../../../../db/policy.repository.js';
import type { WikiSearchHit, WikiSearchRepository } from '../../../../db/wiki-search.repository.js';

const NOW = new Date('2026-05-17T00:00:00.000Z');

function makePage(
  overrides: Partial<{
    id: string;
    slug: string;
    title: string;
    summary: string;
    content: string;
    tags: string[];
    scope: 'AMBIENT' | 'ARCHIVED';
    ownerId: string;
    createdAt: Date;
    updatedAt: Date;
  }> = {},
) {
  return {
    id: 'page-1',
    slug: 'test-page',
    title: 'Test Page',
    summary: 'A test summary',
    content: 'Some content',
    tags: ['domain:eng'],
    scope: 'ARCHIVED' as const,
    ownerId: 'u1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeRepos(
  overrides: {
    pagesCreate?: ReturnType<typeof vi.fn>;
    pagesUpdate?: ReturnType<typeof vi.fn>;
    pagesFindById?: ReturnType<typeof vi.fn>;
    pagesCountAmbient?: ReturnType<typeof vi.fn>;
    pagesListOwned?: ReturnType<typeof vi.fn>;
    linksRebuild?: ReturnType<typeof vi.fn>;
    auditCreate?: ReturnType<typeof vi.fn>;
    userFindById?: ReturnType<typeof vi.fn>;
    policyFindById?: ReturnType<typeof vi.fn>;
    searchSearch?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const createdPage = makePage();
  const updatedPage = makePage({ scope: 'AMBIENT' });

  const create = overrides.pagesCreate ?? vi.fn().mockResolvedValue(createdPage);
  const countAmbient = overrides.pagesCountAmbient ?? vi.fn().mockResolvedValue(0);
  const updateByOwner = overrides.pagesUpdate ?? vi.fn().mockResolvedValue(updatedPage);
  const findById = overrides.pagesFindById ?? vi.fn().mockResolvedValue(null);

  // Default impl of the atomic helpers — mirrors the real repository semantics
  // by consulting the same count mock so existing cap tests keep working.
  const createWithAmbientCap = vi.fn(
    async (data: { scope?: 'AMBIENT' | 'ARCHIVED' }, cap: number) => {
      if (data.scope === 'AMBIENT') {
        const current = await countAmbient();
        if (current >= cap) throw new Error('AMBIENT_CAP_REACHED');
      }
      return create(data);
    },
  );
  const setScopeWithAmbientCap = vi.fn(
    async (_ownerId: string, pageId: string, newScope: 'AMBIENT' | 'ARCHIVED', cap: number) => {
      const existing = await findById(pageId);
      if (!existing) return null;
      if (newScope === 'AMBIENT' && existing.scope !== 'AMBIENT') {
        const current = await countAmbient();
        if (current >= cap) throw new Error('AMBIENT_CAP_REACHED');
      }
      return { ...existing, scope: newScope };
    },
  );

  const pages = {
    create,
    updateByOwner,
    findById,
    countAmbientOwnedBy: countAmbient,
    listOwnedByUser: overrides.pagesListOwned ?? vi.fn().mockResolvedValue([]),
    createWithAmbientCap,
    setScopeWithAmbientCap,
  } as unknown as WikiPageRepository;

  const links = {
    rebuildForPage: overrides.linksRebuild ?? vi.fn().mockResolvedValue(undefined),
  } as unknown as WikiLinkRepository;

  const audit = {
    create: overrides.auditCreate ?? vi.fn().mockResolvedValue({}),
  } as unknown as AuditLogRepository;

  const users = {
    findById: overrides.userFindById ?? vi.fn().mockResolvedValue({ id: 'u1', policyId: 'pol-1' }),
  } as unknown as UserRepository;

  const policies = {
    findById:
      overrides.policyFindById ?? vi.fn().mockResolvedValue({ id: 'pol-1', maxAmbientPages: 5 }),
  } as unknown as PolicyRepository;

  const search = {
    search: overrides.searchSearch ?? vi.fn().mockResolvedValue([]),
  } as unknown as WikiSearchRepository;

  return { pages, links, audit, users, policies, search };
}

function makeHit(overrides: Partial<WikiSearchHit> = {}): WikiSearchHit {
  return {
    id: 'hit-1',
    slug: 'related-slug',
    title: 'Related Page',
    summary: 'a related summary',
    snippet: 'snippet',
    tags: ['domain:eng'],
    score: 1.5,
    isOwned: true,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('wiki_write tool', () => {
  const USER_ID = 'u1';

  describe('create — happy path', () => {
    it('creates a new page and rebuilds backlinks', async () => {
      const linksRebuild = vi.fn().mockResolvedValue(undefined);
      const pagesCreate = vi.fn().mockResolvedValue(makePage());
      const { pages, links, audit, users, policies, search } = makeRepos({
        pagesCreate,
        linksRebuild,
      });

      const tool = createWikiWriteTool(pages, links, audit, users, policies, search, USER_ID);
      const res = await tool.execute({
        title: 'X',
        summary: 's',
        content: 'see [[other]]',
        tags: ['domain:eng'],
      });

      expect(res.isError).toBe(false);
      expect(pagesCreate).toHaveBeenCalledTimes(1);
      expect(linksRebuild).toHaveBeenCalledTimes(1);
      expect(linksRebuild).toHaveBeenCalledWith('page-1', USER_ID, 'see [[other]]');
    });

    it('returns JSON with pageId, slug, and action=created', async () => {
      const { pages, links, audit, users, policies, search } = makeRepos();
      const tool = createWikiWriteTool(pages, links, audit, users, policies, search, USER_ID);

      const res = await tool.execute({ title: 'New', content: 'hello', tags: ['domain:eng'] });

      expect(res.isError).toBe(false);
      const parsed = JSON.parse(res.output);
      expect(parsed).toMatchObject({
        pageId: 'page-1',
        slug: 'test-page',
        action: 'created',
      });
    });
  });

  describe('validation', () => {
    it('rejects content over 10000 chars', async () => {
      const { pages, links, audit, users, policies, search } = makeRepos();
      const tool = createWikiWriteTool(pages, links, audit, users, policies, search, USER_ID);

      const res = await tool.execute({ title: 'X', content: 'a'.repeat(10001) });

      expect(res.isError).toBe(true);
      expect(res.output).toMatch(/10000/);
      // No DB calls
      expect(pages.create as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    });

    it('rejects summary over 200 chars', async () => {
      const { pages, links, audit, users, policies, search } = makeRepos();
      const tool = createWikiWriteTool(pages, links, audit, users, policies, search, USER_ID);

      const res = await tool.execute({
        title: 'X',
        content: 'ok',
        summary: 'x'.repeat(201),
      });

      expect(res.isError).toBe(true);
      expect(res.output).toMatch(/200/);
    });

    it('enforces single domain:* tag when other non-daily tags present', async () => {
      const { pages, links, audit, users, policies, search } = makeRepos();
      const tool = createWikiWriteTool(pages, links, audit, users, policies, search, USER_ID);

      // Two domain tags + another tag → should error
      const res = await tool.execute({
        title: 'X',
        content: 'body',
        tags: ['domain:hr', 'domain:eng', 'extra'],
      });

      expect(res.isError).toBe(true);
      expect(res.output).toMatch(/domain/i);
    });

    it('errors when non-daily tags present but no domain tag', async () => {
      const { pages, links, audit, users, policies, search } = makeRepos();
      const tool = createWikiWriteTool(pages, links, audit, users, policies, search, USER_ID);

      const res = await tool.execute({
        title: 'X',
        content: 'body',
        tags: ['foo', 'bar'],
      });

      expect(res.isError).toBe(true);
    });

    it('allows daily:* tags without a domain tag', async () => {
      const pagesCreate = vi.fn().mockResolvedValue(makePage({ tags: ['daily:2026-05-17'] }));
      const { pages, links, audit, users, policies, search } = makeRepos({ pagesCreate });
      const tool = createWikiWriteTool(pages, links, audit, users, policies, search, USER_ID);

      const res = await tool.execute({
        title: 'Daily Note',
        content: 'Today was good',
        tags: ['daily:2026-05-17'],
      });

      expect(res.isError).toBe(false);
      expect(pagesCreate).toHaveBeenCalledTimes(1);
    });

    it('rejects reserved slug _schema on create', async () => {
      const { pages, links, audit, users, policies, search } = makeRepos();
      const tool = createWikiWriteTool(pages, links, audit, users, policies, search, USER_ID);

      const res = await tool.execute({ title: '_schema', content: 'should fail' });

      expect(res.isError).toBe(true);
      expect(res.output).toMatch(/reserved/i);
      expect(pages.create as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    });
  });

  describe('ambient cap', () => {
    it('returns WIKI_AMBIENT_FULL when scope=AMBIENT and cap exceeded', async () => {
      const ambientPages = [
        makePage({ id: 'a1', title: 'A1', updatedAt: NOW }),
        makePage({ id: 'a2', title: 'A2', updatedAt: NOW }),
        makePage({ id: 'a3', title: 'A3', updatedAt: NOW }),
        makePage({ id: 'a4', title: 'A4', updatedAt: NOW }),
        makePage({ id: 'a5', title: 'A5', updatedAt: NOW }),
      ];
      const { pages, links, audit, users, policies, search } = makeRepos({
        pagesCountAmbient: vi.fn().mockResolvedValue(5),
        pagesListOwned: vi.fn().mockResolvedValue(ambientPages),
        policyFindById: vi.fn().mockResolvedValue({ id: 'pol-1', maxAmbientPages: 5 }),
      });
      const tool = createWikiWriteTool(pages, links, audit, users, policies, search, USER_ID);

      const res = await tool.execute({
        title: 'New Ambient',
        content: 'body',
        tags: ['domain:eng'],
        scope: 'AMBIENT',
      });

      expect(res.isError).toBe(true);
      expect(res.output).toContain('WIKI_AMBIENT_FULL');
      const payload = JSON.parse(res.output.replace('WIKI_AMBIENT_FULL: ', ''));
      expect(payload.cap).toBe(5);
      expect(payload.currentAmbient).toHaveLength(5);
      expect(payload.currentAmbient[0]).toMatchObject({ id: 'a1', title: 'A1' });
    });

    it('skips ambient cap check when updating a page that is already AMBIENT', async () => {
      const existingAmbientPage = makePage({ id: 'page-1', scope: 'AMBIENT' });
      const pagesCountAmbient = vi.fn().mockResolvedValue(5);
      const pagesUpdate = vi.fn().mockResolvedValue(existingAmbientPage);
      const { pages, links, audit, users, policies, search } = makeRepos({
        pagesFindById: vi.fn().mockResolvedValue(existingAmbientPage),
        pagesCountAmbient,
        pagesUpdate,
        policyFindById: vi.fn().mockResolvedValue({ id: 'pol-1', maxAmbientPages: 5 }),
      });
      const tool = createWikiWriteTool(pages, links, audit, users, policies, search, USER_ID);

      const res = await tool.execute({
        pageId: 'page-1',
        title: 'Updated',
        content: 'body',
        scope: 'AMBIENT',
      });

      expect(res.isError).toBe(false);
      // countAmbientOwnedBy should NOT have been called
      expect(pagesCountAmbient).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates existing page when pageId provided', async () => {
      const pagesCreate = vi.fn();
      const pagesUpdate = vi.fn().mockResolvedValue(makePage({ id: 'page-1', scope: 'ARCHIVED' }));
      const pagesFindById = vi.fn().mockResolvedValue(makePage({ scope: 'ARCHIVED' }));
      const { pages, links, audit, users, policies, search } = makeRepos({
        pagesCreate,
        pagesUpdate,
        pagesFindById,
      });
      const tool = createWikiWriteTool(pages, links, audit, users, policies, search, USER_ID);

      const res = await tool.execute({
        pageId: 'page-1',
        title: 'Updated Title',
        content: 'Updated content',
        tags: ['domain:eng'],
      });

      expect(res.isError).toBe(false);
      expect(pagesCreate).not.toHaveBeenCalled();
      expect(pagesUpdate).toHaveBeenCalledTimes(1);
      expect(pagesUpdate).toHaveBeenCalledWith(
        USER_ID,
        'page-1',
        expect.objectContaining({
          title: 'Updated Title',
          content: 'Updated content',
        }),
      );
      const parsed = JSON.parse(res.output);
      expect(parsed.action).toBe('updated');
    });

    it('returns isError when updateByOwner returns null (not found or not owner)', async () => {
      const { pages, links, audit, users, policies, search } = makeRepos({
        pagesUpdate: vi.fn().mockResolvedValue(null),
        pagesFindById: vi.fn().mockResolvedValue(null),
      });
      const tool = createWikiWriteTool(pages, links, audit, users, policies, search, USER_ID);

      const res = await tool.execute({
        pageId: 'nonexistent',
        title: 'X',
        content: 'body',
      });

      expect(res.isError).toBe(true);
      expect(res.output).toMatch(/not found/i);
    });
  });

  describe('audit', () => {
    it('writes wiki.create audit on new page', async () => {
      const auditCreate = vi.fn().mockResolvedValue({});
      const { pages, links, audit, users, policies, search } = makeRepos({ auditCreate });
      const tool = createWikiWriteTool(pages, links, audit, users, policies, search, USER_ID);

      await tool.execute({ title: 'New', content: 'body', tags: ['domain:eng'] });

      expect(auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'wiki.create',
          userId: USER_ID,
          resource: 'wiki_page',
        }),
      );
    });

    it('writes wiki.update audit on update', async () => {
      const auditCreate = vi.fn().mockResolvedValue({});
      const { pages, links, audit, users, policies, search } = makeRepos({
        auditCreate,
        pagesFindById: vi.fn().mockResolvedValue(makePage({ scope: 'ARCHIVED' })),
        pagesUpdate: vi.fn().mockResolvedValue(makePage({ scope: 'ARCHIVED' })),
      });
      const tool = createWikiWriteTool(pages, links, audit, users, policies, search, USER_ID);

      await tool.execute({ pageId: 'page-1', title: 'Updated', content: 'body' });

      expect(auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'wiki.update',
          userId: USER_ID,
        }),
      );
    });

    it('writes wiki.scope_change audit when scope changes from ARCHIVED to AMBIENT', async () => {
      const auditCreate = vi.fn().mockResolvedValue({});
      const archivedPage = makePage({ scope: 'ARCHIVED' });
      const ambientPage = makePage({ scope: 'AMBIENT' });
      const { pages, links, audit, users, policies, search } = makeRepos({
        auditCreate,
        pagesFindById: vi.fn().mockResolvedValue(archivedPage),
        pagesUpdate: vi.fn().mockResolvedValue(ambientPage),
        pagesCountAmbient: vi.fn().mockResolvedValue(0),
      });
      const tool = createWikiWriteTool(pages, links, audit, users, policies, search, USER_ID);

      await tool.execute({
        pageId: 'page-1',
        title: 'Page',
        content: 'body',
        scope: 'AMBIENT',
      });

      // Should have been called twice: once for wiki.update, once for wiki.scope_change
      const calls = auditCreate.mock.calls;
      const scopeChangeCall = calls.find(([arg]) => arg.action === 'wiki.scope_change');
      expect(scopeChangeCall).toBeDefined();
      expect(scopeChangeCall![0]).toMatchObject({
        action: 'wiki.scope_change',
        userId: USER_ID,
        resource: 'wiki_page',
        details: { from: 'ARCHIVED', to: 'AMBIENT' },
      });
    });
  });

  describe('candidate links', () => {
    it('returns candidateLinks and a hint when search finds related visible pages', async () => {
      const hits = [
        makeHit({ id: 'h1', slug: 'remote-work-policy', title: 'Remote Work Policy' }),
        makeHit({ id: 'h2', slug: 'home-office-stipend', title: 'Home Office Stipend' }),
      ];
      const searchSearch = vi.fn().mockResolvedValue(hits);
      const { pages, links, audit, users, policies, search } = makeRepos({ searchSearch });
      const tool = createWikiWriteTool(pages, links, audit, users, policies, search, USER_ID);

      const res = await tool.execute({
        title: 'Working From Home',
        summary: 'guidance for WFH days',
        content: 'No related slugs here yet.',
        tags: ['domain:hr'],
      });

      expect(res.isError).toBe(false);
      expect(searchSearch).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(res.output);
      expect(parsed.candidateLinks).toEqual([
        { slug: 'remote-work-policy', title: 'Remote Work Policy', summary: 'a related summary' },
        { slug: 'home-office-stipend', title: 'Home Office Stipend', summary: 'a related summary' },
      ]);
      expect(parsed.hint).toMatch(/\[\[test-page\]\]/);
    });

    it('excludes slugs already linked from the new content', async () => {
      const hits = [
        makeHit({ id: 'h1', slug: 'already-linked' }),
        makeHit({ id: 'h2', slug: 'new-candidate', title: 'New Candidate' }),
      ];
      const searchSearch = vi.fn().mockResolvedValue(hits);
      const { pages, links, audit, users, policies, search } = makeRepos({ searchSearch });
      const tool = createWikiWriteTool(pages, links, audit, users, policies, search, USER_ID);

      const res = await tool.execute({
        title: 'X',
        summary: 's',
        content: 'See [[already-linked]] for context.',
        tags: ['domain:eng'],
      });

      const parsed = JSON.parse(res.output);
      expect(parsed.candidateLinks).toEqual([
        { slug: 'new-candidate', title: 'New Candidate', summary: 'a related summary' },
      ]);
    });

    it('excludes the just-saved page itself from candidates', async () => {
      // The repo returns the freshly-saved page as page-1; ensure it is filtered.
      const hits = [
        makeHit({ id: 'page-1', slug: 'test-page' }),
        makeHit({ id: 'h2', slug: 'other' }),
      ];
      const searchSearch = vi.fn().mockResolvedValue(hits);
      const { pages, links, audit, users, policies, search } = makeRepos({ searchSearch });
      const tool = createWikiWriteTool(pages, links, audit, users, policies, search, USER_ID);

      const res = await tool.execute({
        title: 'X',
        summary: 's',
        content: 'body',
        tags: ['domain:eng'],
      });

      const parsed = JSON.parse(res.output);
      expect(parsed.candidateLinks.map((c: { slug: string }) => c.slug)).toEqual(['other']);
    });

    it('omits candidateLinks and hint when search returns no relevant pages', async () => {
      const searchSearch = vi.fn().mockResolvedValue([]);
      const { pages, links, audit, users, policies, search } = makeRepos({ searchSearch });
      const tool = createWikiWriteTool(pages, links, audit, users, policies, search, USER_ID);

      const res = await tool.execute({
        title: 'X',
        summary: 's',
        content: 'body',
        tags: ['domain:eng'],
      });

      const parsed = JSON.parse(res.output);
      expect(parsed.candidateLinks).toBeUndefined();
      expect(parsed.hint).toBeUndefined();
    });

    it('caps candidateLinks at 5 even when search returns more', async () => {
      const hits = Array.from({ length: 12 }, (_, i) =>
        makeHit({ id: `h${i}`, slug: `cand-${i}`, title: `Cand ${i}` }),
      );
      const searchSearch = vi.fn().mockResolvedValue(hits);
      const { pages, links, audit, users, policies, search } = makeRepos({ searchSearch });
      const tool = createWikiWriteTool(pages, links, audit, users, policies, search, USER_ID);

      const res = await tool.execute({
        title: 'X',
        summary: 's',
        content: 'body',
        tags: ['domain:eng'],
      });

      const parsed = JSON.parse(res.output);
      expect(parsed.candidateLinks).toHaveLength(5);
    });

    it('still returns success when the candidate-search call throws', async () => {
      const searchSearch = vi.fn().mockRejectedValue(new Error('search down'));
      const { pages, links, audit, users, policies, search } = makeRepos({ searchSearch });
      const tool = createWikiWriteTool(pages, links, audit, users, policies, search, USER_ID);

      const res = await tool.execute({
        title: 'X',
        summary: 's',
        content: 'body',
        tags: ['domain:eng'],
      });

      expect(res.isError).toBe(false);
      const parsed = JSON.parse(res.output);
      expect(parsed.pageId).toBe('page-1');
      expect(parsed.candidateLinks).toBeUndefined();
    });
  });
});
