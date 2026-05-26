import { describe, it, expect, vi } from 'vitest';
import { createWikiShareTool } from '../wiki-share.tool.js';
import type { WikiPageRepository } from '../../../../db/wiki-page.repository.js';
import type { WikiShareRepository } from '../../../../db/wiki-share.repository.js';
import type { AuditLogRepository } from '../../../../db/audit-log.repository.js';
import type { UserRepository } from '../../../../db/user.repository.js';
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

function makeShare(overrides: Partial<{ id: string; targetType: string; groupId?: string }> = {}) {
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
    pagesFindById?: ReturnType<typeof vi.fn>;
    sharesSetOrgShare?: ReturnType<typeof vi.fn>;
    sharesSetGroupShare?: ReturnType<typeof vi.fn>;
    auditCreate?: ReturnType<typeof vi.fn>;
    userFindById?: ReturnType<typeof vi.fn>;
    groupMemberFindFirst?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const pages = {
    findById: overrides.pagesFindById ?? vi.fn().mockResolvedValue(null),
  } as unknown as WikiPageRepository;

  const shares = {
    setOrgShare: overrides.sharesSetOrgShare ?? vi.fn().mockResolvedValue(makeShare()),
    setGroupShare:
      overrides.sharesSetGroupShare ??
      vi.fn().mockResolvedValue(makeShare({ targetType: 'GROUP', groupId: 'g-1' })),
  } as unknown as WikiShareRepository;

  const audit = {
    create: overrides.auditCreate ?? vi.fn().mockResolvedValue({}),
  } as unknown as AuditLogRepository;

  const users = {
    findById: overrides.userFindById ?? vi.fn().mockResolvedValue({ id: 'u1', role: 'developer' }),
  } as unknown as UserRepository;

  const prisma = {
    groupMember: {
      findFirst: overrides.groupMemberFindFirst ?? vi.fn().mockResolvedValue(null),
    },
  } as unknown as PrismaService;

  return { pages, shares, audit, users, prisma };
}

describe('wiki_share tool', () => {
  const USER_ID = 'u1';

  it('rejects org share when caller is not admin', async () => {
    const page = makePage({ ownerId: USER_ID });
    const auditCreate = vi.fn().mockResolvedValue({});
    const { pages, shares, audit, users, prisma } = makeRepos({
      pagesFindById: vi.fn().mockResolvedValue(page),
      userFindById: vi.fn().mockResolvedValue({ id: USER_ID, role: 'developer' }),
      auditCreate,
    });

    const tool = createWikiShareTool(pages, shares, audit, users, prisma, USER_ID);
    const res = await tool.execute({ pageId: 'page-1', targetType: 'org' });

    expect(res.isError).toBe(true);
    expect(res.output).toMatch(/admin/i);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('allows org share when caller is admin and audits with ORG targetType', async () => {
    const page = makePage({ ownerId: USER_ID });
    const share = makeShare({ id: 'share-org-1', targetType: 'ORG' });
    const auditCreate = vi.fn().mockResolvedValue({});
    const sharesSetOrgShare = vi.fn().mockResolvedValue(share);
    const { pages, shares, audit, users, prisma } = makeRepos({
      pagesFindById: vi.fn().mockResolvedValue(page),
      userFindById: vi.fn().mockResolvedValue({ id: USER_ID, role: 'admin' }),
      sharesSetOrgShare,
      auditCreate,
    });

    const tool = createWikiShareTool(pages, shares, audit, users, prisma, USER_ID);
    const res = await tool.execute({ pageId: 'page-1', targetType: 'org' });

    expect(res.isError).toBe(false);
    const parsed = JSON.parse(res.output);
    expect(parsed).toMatchObject({ shareId: 'share-org-1', targetType: 'ORG' });

    expect(sharesSetOrgShare).toHaveBeenCalledWith('page-1', USER_ID);
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        action: 'wiki.share',
        resource: 'wiki_page',
        resourceId: 'page-1',
        details: expect.objectContaining({ shareId: 'share-org-1', targetType: 'ORG' }),
      }),
    );
  });

  it('rejects group share when caller is not a member of the group', async () => {
    const page = makePage({ ownerId: USER_ID });
    const auditCreate = vi.fn().mockResolvedValue({});
    const { pages, shares, audit, users, prisma } = makeRepos({
      pagesFindById: vi.fn().mockResolvedValue(page),
      groupMemberFindFirst: vi.fn().mockResolvedValue(null),
      auditCreate,
    });

    const tool = createWikiShareTool(pages, shares, audit, users, prisma, USER_ID);
    const res = await tool.execute({ pageId: 'page-1', targetType: 'group', groupId: 'g-1' });

    expect(res.isError).toBe(true);
    expect(res.output).toContain('not a member');
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('allows group share when caller is a member and audits with GROUP targetType', async () => {
    const page = makePage({ ownerId: USER_ID });
    const share = makeShare({ id: 'share-g-1', targetType: 'GROUP', groupId: 'g-1' });
    const auditCreate = vi.fn().mockResolvedValue({});
    const sharesSetGroupShare = vi.fn().mockResolvedValue(share);
    const { pages, shares, audit, users, prisma } = makeRepos({
      pagesFindById: vi.fn().mockResolvedValue(page),
      groupMemberFindFirst: vi.fn().mockResolvedValue({ id: 'gm-1' }),
      sharesSetGroupShare,
      auditCreate,
    });

    const tool = createWikiShareTool(pages, shares, audit, users, prisma, USER_ID);
    const res = await tool.execute({ pageId: 'page-1', targetType: 'group', groupId: 'g-1' });

    expect(res.isError).toBe(false);
    const parsed = JSON.parse(res.output);
    expect(parsed).toMatchObject({ shareId: 'share-g-1', targetType: 'GROUP', groupId: 'g-1' });

    expect(sharesSetGroupShare).toHaveBeenCalledWith('page-1', 'g-1', USER_ID);
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        action: 'wiki.share',
        resource: 'wiki_page',
        resourceId: 'page-1',
        details: expect.objectContaining({
          shareId: 'share-g-1',
          targetType: 'GROUP',
          groupId: 'g-1',
        }),
      }),
    );
  });

  it('returns isError when groupId is missing for group target type', async () => {
    const page = makePage({ ownerId: USER_ID });
    const auditCreate = vi.fn().mockResolvedValue({});
    const { pages, shares, audit, users, prisma } = makeRepos({
      pagesFindById: vi.fn().mockResolvedValue(page),
      auditCreate,
    });

    const tool = createWikiShareTool(pages, shares, audit, users, prisma, USER_ID);
    const res = await tool.execute({ pageId: 'page-1', targetType: 'group' });

    expect(res.isError).toBe(true);
    expect(res.output).toContain('groupId');
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
