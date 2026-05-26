import { describe, it, expect, vi } from 'vitest';
import { createWikiUnshareTool } from '../wiki-unshare.tool.js';
import type { WikiPageRepository } from '../../../../db/wiki-page.repository.js';
import type { WikiShareRepository } from '../../../../db/wiki-share.repository.js';
import type { AuditLogRepository } from '../../../../db/audit-log.repository.js';
import type { PrismaService } from '../../../../prisma/prisma.service.js';

function makePage(
  overrides: Partial<{
    id: string;
    slug: string;
    title: string;
    ownerId: string;
  }> = {},
) {
  return {
    id: 'page-1',
    slug: 'test-page',
    title: 'Test Page',
    summary: 'A test summary',
    content: 'Some content',
    tags: ['domain:eng'],
    scope: 'PERSONAL' as const,
    ownerId: 'u1',
    createdAt: new Date('2026-05-17T00:00:00.000Z'),
    updatedAt: new Date('2026-05-17T00:00:00.000Z'),
    ...overrides,
  };
}

function makeShareRow(
  overrides: Partial<{
    id: string;
    pageId: string;
    targetType: string;
    groupId: string | null;
    isRevoked: boolean;
  }> = {},
) {
  return {
    id: 'share-1',
    pageId: 'page-1',
    sharedBy: 'u1',
    sharedAt: new Date(),
    targetType: 'ORG',
    groupId: null,
    isRevoked: false,
    revokedAt: null,
    ...overrides,
  };
}

function makeRepos(
  overrides: {
    wikiShareFindUnique?: ReturnType<typeof vi.fn>;
    pagesFindById?: ReturnType<typeof vi.fn>;
    sharesRevokeShareById?: ReturnType<typeof vi.fn>;
    auditCreate?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const prisma = {
    wikiShare: {
      findUnique: overrides.wikiShareFindUnique ?? vi.fn().mockResolvedValue(null),
    },
  } as unknown as PrismaService;

  const pages = {
    findById: overrides.pagesFindById ?? vi.fn().mockResolvedValue(null),
  } as unknown as WikiPageRepository;

  const shares = {
    revokeShareById: overrides.sharesRevokeShareById ?? vi.fn().mockResolvedValue(true),
  } as unknown as WikiShareRepository;

  const audit = {
    create: overrides.auditCreate ?? vi.fn().mockResolvedValue({}),
  } as unknown as AuditLogRepository;

  return { prisma, pages, shares, audit };
}

describe('wiki_unshare tool', () => {
  const USER_ID = 'u1';

  it('revokes a share owned by the caller and emits an audit row', async () => {
    const shareRow = makeShareRow({ id: 'share-1', pageId: 'page-1', targetType: 'ORG' });
    const page = makePage({ ownerId: USER_ID });
    const auditCreate = vi.fn().mockResolvedValue({});
    const sharesRevokeShareById = vi.fn().mockResolvedValue(true);
    const { prisma, pages, shares, audit } = makeRepos({
      wikiShareFindUnique: vi.fn().mockResolvedValue(shareRow),
      pagesFindById: vi.fn().mockResolvedValue(page),
      sharesRevokeShareById,
      auditCreate,
    });

    const tool = createWikiUnshareTool(prisma, pages, shares, audit, USER_ID);
    const res = await tool.execute({ shareId: 'share-1' });

    expect(res.isError).toBe(false);
    const parsed = JSON.parse(res.output);
    expect(parsed).toMatchObject({ revoked: true, shareId: 'share-1' });

    expect(sharesRevokeShareById).toHaveBeenCalledWith('share-1');
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        action: 'wiki.unshare',
        resource: 'wiki_page',
        resourceId: 'page-1',
        details: expect.objectContaining({ shareId: 'share-1', targetType: 'ORG' }),
      }),
    );
  });

  it('refuses to revoke a share when page belongs to someone else', async () => {
    const shareRow = makeShareRow({ id: 'share-1', pageId: 'page-1' });
    const page = makePage({ ownerId: 'other-user' });
    const auditCreate = vi.fn().mockResolvedValue({});
    const sharesRevokeShareById = vi.fn().mockResolvedValue(true);
    const { prisma, pages, shares, audit } = makeRepos({
      wikiShareFindUnique: vi.fn().mockResolvedValue(shareRow),
      pagesFindById: vi.fn().mockResolvedValue(page),
      sharesRevokeShareById,
      auditCreate,
    });

    const tool = createWikiUnshareTool(prisma, pages, shares, audit, USER_ID);
    const res = await tool.execute({ shareId: 'share-1' });

    expect(res.isError).toBe(true);
    expect(sharesRevokeShareById).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('returns isError when share does not exist and does not audit', async () => {
    const auditCreate = vi.fn().mockResolvedValue({});
    const { prisma, pages, shares, audit } = makeRepos({
      wikiShareFindUnique: vi.fn().mockResolvedValue(null),
      auditCreate,
    });

    const tool = createWikiUnshareTool(prisma, pages, shares, audit, USER_ID);
    const res = await tool.execute({ shareId: 'nonexistent' });

    expect(res.isError).toBe(true);
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
