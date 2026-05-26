import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { WikiService } from '../wiki.service.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function makeShare(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'share-1',
    pageId: 'page-1',
    sharedBy: 'u1',
    targetType: 'ORG',
    groupId: null,
    sharedAt: NOW,
    revokedAt: null,
    isRevoked: false,
    ...overrides,
  };
}

function makeService(
  overrides: {
    pagesCreate?: ReturnType<typeof vi.fn>;
    pagesUpdateByOwner?: ReturnType<typeof vi.fn>;
    pagesFindById?: ReturnType<typeof vi.fn>;
    pagesFindBySlug?: ReturnType<typeof vi.fn>;
    pagesFindVisibleToUser?: ReturnType<typeof vi.fn>;
    pagesFindVisibleByIdToUser?: ReturnType<typeof vi.fn>;
    pagesFindManyByIds?: ReturnType<typeof vi.fn>;
    pagesCreateWithAmbientCap?: ReturnType<typeof vi.fn>;
    pagesSetScopeWithAmbientCap?: ReturnType<typeof vi.fn>;
    pagesListOwnedByUser?: ReturnType<typeof vi.fn>;
    pagesCountOwnedBy?: ReturnType<typeof vi.fn>;
    pagesCountAmbientOwnedBy?: ReturnType<typeof vi.fn>;
    pagesDeleteByOwner?: ReturnType<typeof vi.fn>;
    linksRebuildForPage?: ReturnType<typeof vi.fn>;
    linksFindBacklinks?: ReturnType<typeof vi.fn>;
    linksFindEdgesAmongPages?: ReturnType<typeof vi.fn>;
    sharesSetOrgShare?: ReturnType<typeof vi.fn>;
    sharesSetGroupShare?: ReturnType<typeof vi.fn>;
    sharesRevokeShareById?: ReturnType<typeof vi.fn>;
    sharesFindPageIdsWithOrgShare?: ReturnType<typeof vi.fn>;
    sharesFindActiveSharesForPage?: ReturnType<typeof vi.fn>;
    auditCreate?: ReturnType<typeof vi.fn>;
    usersFindById?: ReturnType<typeof vi.fn>;
    policiesFindById?: ReturnType<typeof vi.fn>;
    prismaGroupMemberFindFirst?: ReturnType<typeof vi.fn>;
    prismaWikiShareFindUnique?: ReturnType<typeof vi.fn>;
    prismaWikiShareFindFirst?: ReturnType<typeof vi.fn>;
    prismaWikiPageCreate?: ReturnType<typeof vi.fn>;
    prismaWikiPageUpdate?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const defaultPage = makePage();

  const create = overrides.pagesCreate ?? vi.fn().mockResolvedValue(defaultPage);
  const countAmbient = overrides.pagesCountAmbientOwnedBy ?? vi.fn().mockResolvedValue(0);
  const findById = overrides.pagesFindById ?? vi.fn().mockResolvedValue(defaultPage);

  // The atomic helpers default to mirroring the real repo semantics, consulting
  // the same count mock so existing cap-test setups (which only override
  // pagesCountAmbientOwnedBy) keep working.
  const createWithAmbientCap =
    overrides.pagesCreateWithAmbientCap ??
    vi.fn(async (data: { scope?: 'AMBIENT' | 'ARCHIVED' }, cap: number) => {
      if (data.scope === 'AMBIENT') {
        const current = await countAmbient();
        if (current >= cap) throw new Error('AMBIENT_CAP_REACHED');
      }
      return create(data);
    });
  const setScopeWithAmbientCap =
    overrides.pagesSetScopeWithAmbientCap ??
    vi.fn(
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
    updateByOwner: overrides.pagesUpdateByOwner ?? vi.fn().mockResolvedValue(defaultPage),
    findById,
    findBySlug: overrides.pagesFindBySlug ?? vi.fn().mockResolvedValue(null),
    findVisibleToUser: overrides.pagesFindVisibleToUser ?? vi.fn().mockResolvedValue([defaultPage]),
    findVisibleByIdToUser:
      overrides.pagesFindVisibleByIdToUser ?? vi.fn().mockResolvedValue(defaultPage),
    findManyByIds: overrides.pagesFindManyByIds ?? vi.fn().mockResolvedValue([defaultPage]),
    listOwnedByUser: overrides.pagesListOwnedByUser ?? vi.fn().mockResolvedValue([defaultPage]),
    countOwnedBy: overrides.pagesCountOwnedBy ?? vi.fn().mockResolvedValue(0),
    countAmbientOwnedBy: countAmbient,
    deleteByOwner: overrides.pagesDeleteByOwner ?? vi.fn().mockResolvedValue(true),
    createWithAmbientCap,
    setScopeWithAmbientCap,
  };

  const links = {
    rebuildForPage: overrides.linksRebuildForPage ?? vi.fn().mockResolvedValue(undefined),
    findBacklinks: overrides.linksFindBacklinks ?? vi.fn().mockResolvedValue([]),
    findEdgesAmongPages: overrides.linksFindEdgesAmongPages ?? vi.fn().mockResolvedValue([]),
  };

  const shares = {
    setOrgShare: overrides.sharesSetOrgShare ?? vi.fn().mockResolvedValue(makeShare()),
    setGroupShare:
      overrides.sharesSetGroupShare ??
      vi.fn().mockResolvedValue(makeShare({ targetType: 'GROUP', groupId: 'g1' })),
    revokeShareById: overrides.sharesRevokeShareById ?? vi.fn().mockResolvedValue(true),
    findPageIdsWithOrgShare:
      overrides.sharesFindPageIdsWithOrgShare ?? vi.fn().mockResolvedValue([]),
    findActiveSharesForPage:
      overrides.sharesFindActiveSharesForPage ?? vi.fn().mockResolvedValue([]),
  };

  const audit = {
    create: overrides.auditCreate ?? vi.fn().mockResolvedValue({}),
  };

  const users = {
    findById:
      overrides.usersFindById ??
      vi.fn().mockResolvedValue({ id: 'u1', role: 'admin', policyId: 'pol-1' }),
  };

  const policies = {
    findById:
      overrides.policiesFindById ??
      vi.fn().mockResolvedValue({ id: 'pol-1', maxAmbientPages: 5, wikiLintEnabled: true }),
  };

  const prisma = {
    groupMember: {
      findFirst:
        overrides.prismaGroupMemberFindFirst ??
        vi.fn().mockResolvedValue({ userId: 'u1', groupId: 'g1' }),
    },
    wikiShare: {
      findUnique: overrides.prismaWikiShareFindUnique ?? vi.fn().mockResolvedValue(makeShare()),
      findFirst: overrides.prismaWikiShareFindFirst ?? vi.fn().mockResolvedValue(makeShare()),
    },
    wikiPage: {
      create: overrides.prismaWikiPageCreate ?? vi.fn().mockResolvedValue(makePage()),
      update: overrides.prismaWikiPageUpdate ?? vi.fn().mockResolvedValue(makePage()),
    },
  };

  const service = new WikiService(
    prisma as never,
    pages as never,
    links as never,
    shares as never,
    audit as never,
    policies as never,
    users as never,
  );

  return { service, pages, links, shares, audit, users, policies, prisma };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const USER_ID = 'u1';

describe('WikiService', () => {
  // ── createPage ──────────────────────────────────────────────────────────────

  describe('createPage', () => {
    it('throws 400 when summary is missing', async () => {
      const { service } = makeService();
      await expect(
        service.createPage(USER_ID, {
          title: 'No Summary',
          summary: '',
          content: 'body',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 400 when summary is whitespace-only', async () => {
      const { service } = makeService();
      await expect(
        service.createPage(USER_ID, {
          title: 'No Summary',
          summary: '   ',
          content: 'body',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('checks ambient cap when scope=AMBIENT and throws 400 when cap exceeded', async () => {
      const { service } = makeService({
        pagesCountAmbientOwnedBy: vi.fn().mockResolvedValue(5),
        policiesFindById: vi.fn().mockResolvedValue({ id: 'pol-1', maxAmbientPages: 5 }),
      });
      await expect(
        service.createPage(USER_ID, {
          title: 'Pinned',
          summary: 'A summary',
          content: 'body',
          scope: 'AMBIENT',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates page and returns DTO with isOrgShared=false on success', async () => {
      const page = makePage({ id: 'new-id', slug: 'my-page' });
      const pagesCreate = vi.fn().mockResolvedValue(page);
      const linksRebuildForPage = vi.fn().mockResolvedValue(undefined);
      const { service } = makeService({ pagesCreate, linksRebuildForPage });

      const result = await service.createPage(USER_ID, {
        title: 'My Page',
        summary: 'A good summary',
        content: 'some content',
      });

      expect(pagesCreate).toHaveBeenCalledTimes(1);
      expect(linksRebuildForPage).toHaveBeenCalledTimes(1);
      expect(result.isOrgShared).toBe(false);
      expect(result.isOwned).toBe(true);
    });
  });

  // ── updatePage ──────────────────────────────────────────────────────────────

  describe('updatePage', () => {
    it('throws 403 when caller is not the owner', async () => {
      const { service } = makeService({
        pagesFindById: vi.fn().mockResolvedValue(makePage({ ownerId: 'other-user' })),
      });
      await expect(service.updatePage(USER_ID, 'page-1', { title: 'Updated' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws 400 when trying to update the _schema page directly', async () => {
      const { service } = makeService({
        pagesFindById: vi.fn().mockResolvedValue(makePage({ slug: '_schema', ownerId: USER_ID })),
      });
      await expect(
        service.updatePage(USER_ID, 'page-1', { title: 'Hacked Schema' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('writes wiki.scope_change audit when scope flips from ARCHIVED to AMBIENT', async () => {
      const auditCreate = vi.fn().mockResolvedValue({});
      const archivedPage = makePage({ scope: 'ARCHIVED', ownerId: USER_ID });
      const ambientPage = makePage({ scope: 'AMBIENT', ownerId: USER_ID });

      const { service } = makeService({
        pagesFindById: vi.fn().mockResolvedValue(archivedPage),
        pagesUpdateByOwner: vi.fn().mockResolvedValue(ambientPage),
        pagesCountAmbientOwnedBy: vi.fn().mockResolvedValue(0),
        auditCreate,
      });

      await service.updatePage(USER_ID, 'page-1', { scope: 'AMBIENT' });

      const calls = auditCreate.mock.calls.map(([arg]) => arg);
      const scopeChange = calls.find((c: { action: string }) => c.action === 'wiki.scope_change');
      expect(scopeChange).toBeDefined();
      expect(scopeChange).toMatchObject({
        action: 'wiki.scope_change',
        userId: USER_ID,
        details: { from: 'ARCHIVED', to: 'AMBIENT' },
      });
    });

    it('does NOT write wiki.scope_change audit when scope is unchanged', async () => {
      const auditCreate = vi.fn().mockResolvedValue({});
      const page = makePage({ scope: 'ARCHIVED', ownerId: USER_ID });

      const { service } = makeService({
        pagesFindById: vi.fn().mockResolvedValue(page),
        pagesUpdateByOwner: vi.fn().mockResolvedValue(page),
        auditCreate,
      });

      await service.updatePage(USER_ID, 'page-1', { title: 'New Title' });

      const calls = auditCreate.mock.calls.map(([arg]) => arg);
      expect(
        calls.find((c: { action: string }) => c.action === 'wiki.scope_change'),
      ).toBeUndefined();
    });
  });

  // ── deletePage ──────────────────────────────────────────────────────────────

  describe('deletePage', () => {
    it('throws 400 when trying to delete the _schema page', async () => {
      const { service } = makeService({
        pagesFindById: vi.fn().mockResolvedValue(makePage({ slug: '_schema', ownerId: USER_ID })),
      });
      await expect(service.deletePage(USER_ID, 'page-1')).rejects.toThrow(BadRequestException);
    });

    it('throws 403 when caller is not the owner', async () => {
      const { service } = makeService({
        pagesFindById: vi.fn().mockResolvedValue(makePage({ ownerId: 'other' })),
      });
      await expect(service.deletePage(USER_ID, 'page-1')).rejects.toThrow(ForbiddenException);
    });

    it('deletes page and writes audit on success', async () => {
      const auditCreate = vi.fn().mockResolvedValue({});
      const pagesDeleteByOwner = vi.fn().mockResolvedValue(true);
      const { service } = makeService({ auditCreate, pagesDeleteByOwner });

      await service.deletePage(USER_ID, 'page-1');

      expect(pagesDeleteByOwner).toHaveBeenCalledWith(USER_ID, 'page-1');
      expect(auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'wiki.delete', userId: USER_ID }),
      );
    });
  });

  // ── listPages ───────────────────────────────────────────────────────────────

  describe('listPages', () => {
    it('returns isOrgShared=true for pages with an active org share', async () => {
      const page = makePage({ id: 'page-org' });
      const { service } = makeService({
        pagesListOwnedByUser: vi.fn().mockResolvedValue([page]),
        sharesFindPageIdsWithOrgShare: vi.fn().mockResolvedValue(['page-org']),
      });

      const results = await service.listPages(USER_ID, { ownership: 'mine' });

      expect(results).toHaveLength(1);
      expect(results[0]!.isOrgShared).toBe(true);
    });

    it('returns isOrgShared=false for pages without an org share', async () => {
      const page = makePage({ id: 'page-no-share' });
      const { service } = makeService({
        pagesListOwnedByUser: vi.fn().mockResolvedValue([page]),
        sharesFindPageIdsWithOrgShare: vi.fn().mockResolvedValue([]),
      });

      const results = await service.listPages(USER_ID, { ownership: 'mine' });

      expect(results[0]!.isOrgShared).toBe(false);
    });

    it('filters by query string (title match)', async () => {
      const pages = [
        makePage({ id: 'p1', title: 'Alpha Guide' }),
        makePage({ id: 'p2', title: 'Beta Reference' }),
      ];
      const { service } = makeService({
        pagesListOwnedByUser: vi.fn().mockResolvedValue(pages),
        sharesFindPageIdsWithOrgShare: vi.fn().mockResolvedValue([]),
      });

      const results = await service.listPages(USER_ID, { ownership: 'mine', query: 'alpha' });

      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('p1');
    });

    it('excludes _schema and kind:schema pages (edited via the dedicated schema endpoint)', async () => {
      const regular = makePage({ id: 'p1', slug: 'alpha', tags: ['domain:hr'] });
      const schemaPage = makePage({ id: 'ps', slug: '_schema', tags: ['kind:schema'] });
      const taggedSchema = makePage({ id: 'pk', slug: 'foo', tags: ['kind:schema'] });
      const { service } = makeService({
        pagesListOwnedByUser: vi.fn().mockResolvedValue([regular, schemaPage, taggedSchema]),
        sharesFindPageIdsWithOrgShare: vi.fn().mockResolvedValue([]),
      });

      const results = await service.listPages(USER_ID, { ownership: 'mine' });

      expect(results.map((p) => p.slug)).toEqual(['alpha']);
    });
  });

  // ── sharePage ───────────────────────────────────────────────────────────────

  describe('sharePage', () => {
    it('throws 403 when org sharing and caller is not admin', async () => {
      const { service } = makeService({
        usersFindById: vi
          .fn()
          .mockResolvedValue({ id: USER_ID, role: 'developer', policyId: 'pol-1' }),
      });
      await expect(service.sharePage(USER_ID, 'page-1', { targetType: 'org' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('creates org share when caller is admin', async () => {
      const sharesSetOrgShare = vi.fn().mockResolvedValue(makeShare());
      const { service } = makeService({
        usersFindById: vi.fn().mockResolvedValue({ id: USER_ID, role: 'admin', policyId: 'pol-1' }),
        sharesSetOrgShare,
      });

      const result = await service.sharePage(USER_ID, 'page-1', { targetType: 'org' });

      expect(sharesSetOrgShare).toHaveBeenCalledWith('page-1', USER_ID);
      expect(result.shareId).toBe('share-1');
    });

    it('throws 403 when group sharing and caller is not a group member', async () => {
      const { service } = makeService({
        prismaGroupMemberFindFirst: vi.fn().mockResolvedValue(null),
      });
      await expect(
        service.sharePage(USER_ID, 'page-1', { targetType: 'group', groupId: 'g1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates group share when caller is a group member', async () => {
      const sharesSetGroupShare = vi
        .fn()
        .mockResolvedValue(makeShare({ targetType: 'GROUP', groupId: 'g1' }));
      const { service } = makeService({ sharesSetGroupShare });

      const result = await service.sharePage(USER_ID, 'page-1', {
        targetType: 'group',
        groupId: 'g1',
      });

      expect(sharesSetGroupShare).toHaveBeenCalledWith('page-1', 'g1', USER_ID);
      expect(result.shareId).toBe('share-1');
    });
  });

  // ── revokeShare ─────────────────────────────────────────────────────────────

  describe('revokeShare', () => {
    it('throws 403 when caller does not own the page', async () => {
      const { service } = makeService({
        prismaWikiShareFindUnique: vi.fn().mockResolvedValue(makeShare({ pageId: 'page-1' })),
        pagesFindById: vi.fn().mockResolvedValue(makePage({ ownerId: 'other' })),
      });
      await expect(service.revokeShare(USER_ID, 'share-1')).rejects.toThrow(ForbiddenException);
    });

    it('throws 404 when share does not exist', async () => {
      const { service } = makeService({
        prismaWikiShareFindUnique: vi.fn().mockResolvedValue(null),
      });
      await expect(service.revokeShare(USER_ID, 'nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('throws 400 when share is already revoked', async () => {
      const { service } = makeService({
        sharesRevokeShareById: vi.fn().mockResolvedValue(false),
      });
      await expect(service.revokeShare(USER_ID, 'share-1')).rejects.toThrow(BadRequestException);
    });

    it('revokes share and writes audit on success', async () => {
      const auditCreate = vi.fn().mockResolvedValue({});
      const sharesRevokeShareById = vi.fn().mockResolvedValue(true);
      const { service } = makeService({ auditCreate, sharesRevokeShareById });

      await service.revokeShare(USER_ID, 'share-1');

      expect(sharesRevokeShareById).toHaveBeenCalledWith('share-1');
      expect(auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'wiki.unshare', userId: USER_ID }),
      );
    });
  });

  // ── revokeOrgShare ──────────────────────────────────────────────────────────

  describe('revokeOrgShare', () => {
    it('revokes active org share and writes audit on success', async () => {
      const auditCreate = vi.fn().mockResolvedValue({});
      const sharesRevokeShareById = vi.fn().mockResolvedValue(true);
      const { service } = makeService({ auditCreate, sharesRevokeShareById });

      await service.revokeOrgShare(USER_ID, 'page-1');

      expect(sharesRevokeShareById).toHaveBeenCalledWith('share-1');
      expect(auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'wiki.unshare',
          userId: USER_ID,
          details: expect.objectContaining({ targetType: 'ORG' }),
        }),
      );
    });

    it('throws 403 when caller is not the page owner', async () => {
      const { service } = makeService({
        pagesFindById: vi.fn().mockResolvedValue(makePage({ ownerId: 'other-user' })),
      });
      await expect(service.revokeOrgShare(USER_ID, 'page-1')).rejects.toThrow(ForbiddenException);
    });
  });

  // ── getSchema / bootstrapSchemaPage ─────────────────────────────────────────

  describe('getSchema', () => {
    it('bootstraps the schema page when it does not exist yet', async () => {
      const schemaPage = makePage({ slug: '_schema', content: '# Schema\n' });
      const pagesFindBySlug = vi
        .fn()
        .mockResolvedValueOnce(null) // first call: doesn't exist → bootstrap
        .mockResolvedValueOnce(schemaPage); // second call: after create
      const prismaWikiPageCreate = vi.fn().mockResolvedValue(schemaPage);

      const { service } = makeService({ pagesFindBySlug, prismaWikiPageCreate });

      const result = await service.getSchema(USER_ID);

      expect(prismaWikiPageCreate).toHaveBeenCalledTimes(1);
      expect(result.content).toBe('# Schema\n');
    });

    it('returns existing schema page without re-creating it', async () => {
      const schemaPage = makePage({ slug: '_schema', content: 'existing content' });
      const pagesFindBySlug = vi.fn().mockResolvedValue(schemaPage);
      const prismaWikiPageCreate = vi.fn();

      const { service } = makeService({ pagesFindBySlug, prismaWikiPageCreate });

      const result = await service.getSchema(USER_ID);

      expect(prismaWikiPageCreate).not.toHaveBeenCalled();
      expect(result.content).toBe('existing content');
    });
  });

  // ── updateSchema ─────────────────────────────────────────────────────────────

  describe('updateSchema', () => {
    it('writes wiki.schema_update audit on update', async () => {
      const auditCreate = vi.fn().mockResolvedValue({});
      const schemaPage = makePage({ id: 'schema-id', slug: '_schema' });
      const pagesFindBySlug = vi.fn().mockResolvedValue(schemaPage);

      const { service } = makeService({ auditCreate, pagesFindBySlug });

      await service.updateSchema(USER_ID, '# Updated Schema\n');

      expect(auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'wiki.schema_update',
          userId: USER_ID,
          resource: 'wiki_page',
          resourceId: 'schema-id',
        }),
      );
    });
  });

  // ── getGraph ─────────────────────────────────────────────────────────────────

  describe('getGraph', () => {
    it('returns visible nodes + edges; excludes _schema and kind:schema pages', async () => {
      const a = makePage({ id: 'pa', slug: 'a', tags: ['domain:hr'], ownerId: USER_ID });
      const b = makePage({ id: 'pb', slug: 'b', tags: ['domain:hr'], ownerId: USER_ID });
      const schemaPage = makePage({
        id: 'ps',
        slug: '_schema',
        tags: ['kind:schema'],
        ownerId: USER_ID,
      });
      const tagged = makePage({
        id: 'pk',
        slug: 'foo',
        tags: ['kind:schema'],
        ownerId: USER_ID,
      });

      const { service, links } = makeService({
        pagesFindVisibleToUser: vi.fn().mockResolvedValue([a, b, schemaPage, tagged]),
        linksFindEdgesAmongPages: vi.fn().mockResolvedValue([{ fromPageId: 'pa', toPageId: 'pb' }]),
        sharesFindPageIdsWithOrgShare: vi.fn().mockResolvedValue([]),
      });

      const graph = await service.getGraph(USER_ID, { ownership: 'visible' });

      expect(graph.nodes.map((n) => n.slug).sort()).toEqual(['a', 'b']);
      expect(graph.edges).toEqual([{ from: 'pa', to: 'pb' }]);
      expect(graph.nodes.find((n) => n.slug === 'a')).toMatchObject({
        domain: 'hr',
        isDaily: false,
        isOwned: true,
      });
      expect(links.findEdgesAmongPages).toHaveBeenCalledWith(['pa', 'pb']);
    });

    it('ownership=mine calls listOwnedByUser instead of findVisibleToUser', async () => {
      const a = makePage({ id: 'pa', slug: 'a', tags: ['domain:hr'], ownerId: USER_ID });
      const { service, pages } = makeService({
        pagesListOwnedByUser: vi.fn().mockResolvedValue([a]),
        pagesFindVisibleToUser: vi.fn().mockResolvedValue([]),
        linksFindEdgesAmongPages: vi.fn().mockResolvedValue([]),
      });

      const graph = await service.getGraph(USER_ID, { ownership: 'mine' });

      expect(pages.listOwnedByUser).toHaveBeenCalled();
      expect(pages.findVisibleToUser).not.toHaveBeenCalled();
      expect(graph.nodes.map((n) => n.slug)).toEqual(['a']);
    });

    it('marks daily-note pages with isDaily=true and a null domain', async () => {
      const d = makePage({
        id: 'pd',
        slug: 'daily-2026-05-19',
        tags: ['daily:2026-05-19'],
        ownerId: USER_ID,
      });
      const { service } = makeService({
        pagesListOwnedByUser: vi.fn().mockResolvedValue([d]),
        linksFindEdgesAmongPages: vi.fn().mockResolvedValue([]),
      });
      const graph = await service.getGraph(USER_ID, { ownership: 'mine' });
      expect(graph.nodes[0]).toMatchObject({ isDaily: true, domain: null });
    });

    it('marks pages where ownerId !== userId as isOwned=false', async () => {
      const friendsPage = makePage({
        id: 'pf',
        slug: 'friends',
        tags: ['domain:hr'],
        ownerId: 'other-user',
      });
      const { service } = makeService({
        pagesFindVisibleToUser: vi.fn().mockResolvedValue([friendsPage]),
        linksFindEdgesAmongPages: vi.fn().mockResolvedValue([]),
        sharesFindPageIdsWithOrgShare: vi.fn().mockResolvedValue(['pf']),
      });
      const graph = await service.getGraph(USER_ID, { ownership: 'visible' });
      expect(graph.nodes[0]).toMatchObject({ isOwned: false, isOrgShared: true });
    });
  });

  // ── runLint ──────────────────────────────────────────────────────────────────

  describe('runLint', () => {
    it('throws 403 when wikiLintEnabled=false on policy', async () => {
      const { service } = makeService({
        policiesFindById: vi.fn().mockResolvedValue({
          id: 'pol-1',
          wikiLintEnabled: false,
        }),
      });
      await expect(service.runLint(USER_ID)).rejects.toThrow(ForbiddenException);
    });

    it('returns findings and writes one wiki.lint audit row on success', async () => {
      const auditCreate = vi.fn().mockResolvedValue({});
      // Page with no summary → triggers missing-summaries finding
      const page = makePage({ summary: '' });
      const pagesListOwnedByUser = vi.fn().mockResolvedValue([page]);
      const linksFindBacklinks = vi.fn().mockResolvedValue([]);

      const { service } = makeService({
        pagesListOwnedByUser,
        linksFindBacklinks,
        auditCreate,
        policiesFindById: vi.fn().mockResolvedValue({
          id: 'pol-1',
          wikiLintEnabled: true,
        }),
      });

      const findings = await service.runLint(USER_ID, ['missing-summaries'], 10);

      expect(findings).toHaveLength(1);
      expect(findings[0]!.finding).toBe('missing-summaries');
      expect(auditCreate).toHaveBeenCalledTimes(1);
      expect(auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'wiki.lint',
          userId: USER_ID,
          details: expect.objectContaining({ findingsCount: 1 }),
        }),
      );
    });

    it('defaults wikiLintEnabled to true when policy does not have the field', async () => {
      const { service } = makeService({
        policiesFindById: vi.fn().mockResolvedValue({ id: 'pol-1' }), // no wikiLintEnabled
        pagesListOwnedByUser: vi.fn().mockResolvedValue([]),
      });
      // Should NOT throw
      await expect(service.runLint(USER_ID)).resolves.toEqual([]);
    });

    it('runs all checks when none specified', async () => {
      const auditCreate = vi.fn().mockResolvedValue({});
      const pagesListOwnedByUser = vi.fn().mockResolvedValue([]);
      const linksFindBacklinks = vi.fn().mockResolvedValue([]);

      const { service } = makeService({ auditCreate, pagesListOwnedByUser, linksFindBacklinks });

      await service.runLint(USER_ID);

      expect(auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({
            checks: ['orphans', 'missing-summaries', 'stale-claims', 'broken-links'],
          }),
        }),
      );
    });
  });
});
