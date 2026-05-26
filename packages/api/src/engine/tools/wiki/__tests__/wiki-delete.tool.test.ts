import { describe, it, expect, vi } from 'vitest';
import { createWikiDeleteTool } from '../wiki-delete.tool.js';
import type { WikiPageRepository } from '../../../../db/wiki-page.repository.js';
import type { WikiLinkRepository } from '../../../../db/wiki-link.repository.js';
import type { AuditLogRepository } from '../../../../db/audit-log.repository.js';

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
    scope: 'ARCHIVED' as const,
    ownerId: 'u1',
    createdAt: new Date('2026-05-17T00:00:00.000Z'),
    updatedAt: new Date('2026-05-17T00:00:00.000Z'),
    ...overrides,
  };
}

function makeRepos(
  overrides: {
    pagesFindById?: ReturnType<typeof vi.fn>;
    pagesDeleteByOwner?: ReturnType<typeof vi.fn>;
    linksDeleteAllForPage?: ReturnType<typeof vi.fn>;
    auditCreate?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const pages = {
    findById: overrides.pagesFindById ?? vi.fn().mockResolvedValue(null),
    deleteByOwner: overrides.pagesDeleteByOwner ?? vi.fn().mockResolvedValue(true),
  } as unknown as WikiPageRepository;

  const links = {
    deleteAllForPage: overrides.linksDeleteAllForPage ?? vi.fn().mockResolvedValue(undefined),
  } as unknown as WikiLinkRepository;

  const audit = {
    create: overrides.auditCreate ?? vi.fn().mockResolvedValue({}),
  } as unknown as AuditLogRepository;

  return { pages, links, audit };
}

describe('wiki_delete tool', () => {
  const USER_ID = 'u1';

  it('deletes a page owned by the caller and audits', async () => {
    const page = makePage({ ownerId: 'u1' });
    const auditCreate = vi.fn().mockResolvedValue({});
    const pagesDeleteByOwner = vi.fn().mockResolvedValue(true);
    const linksDeleteAllForPage = vi.fn().mockResolvedValue(undefined);
    const { pages, links, audit } = makeRepos({
      pagesFindById: vi.fn().mockResolvedValue(page),
      pagesDeleteByOwner,
      linksDeleteAllForPage,
      auditCreate,
    });

    const tool = createWikiDeleteTool(pages, links, audit, USER_ID);
    const res = await tool.execute({ pageId: 'page-1' });

    expect(res.isError).toBe(false);
    const parsed = JSON.parse(res.output);
    expect(parsed).toMatchObject({ deleted: true, pageId: 'page-1' });

    expect(pagesDeleteByOwner).toHaveBeenCalledWith(USER_ID, 'page-1');
    expect(linksDeleteAllForPage).toHaveBeenCalledWith('page-1');
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        action: 'wiki.delete',
        resource: 'wiki_page',
        resourceId: 'page-1',
        details: { slug: page.slug, title: page.title },
      }),
    );
  });

  it('refuses to delete pages owned by others', async () => {
    const page = makePage({ ownerId: 'other' });
    const auditCreate = vi.fn().mockResolvedValue({});
    const pagesDeleteByOwner = vi.fn().mockResolvedValue(false);
    const { pages, links, audit } = makeRepos({
      pagesFindById: vi.fn().mockResolvedValue(page),
      pagesDeleteByOwner,
      auditCreate,
    });

    const tool = createWikiDeleteTool(pages, links, audit, USER_ID);
    const res = await tool.execute({ pageId: 'page-1' });

    expect(res.isError).toBe(true);
    expect(res.output).toBe("You don't own this page");
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('returns isError when page does not exist', async () => {
    const auditCreate = vi.fn().mockResolvedValue({});
    const pagesDeleteByOwner = vi.fn().mockResolvedValue(false);
    const { pages, links, audit } = makeRepos({
      pagesFindById: vi.fn().mockResolvedValue(null),
      pagesDeleteByOwner,
      auditCreate,
    });

    const tool = createWikiDeleteTool(pages, links, audit, USER_ID);
    const res = await tool.execute({ pageId: 'nonexistent' });

    expect(res.isError).toBe(true);
    expect(res.output).toBe('No such page');
    expect(pagesDeleteByOwner).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('returns isError when pageId is missing', async () => {
    const pagesFindById = vi.fn();
    const pagesDeleteByOwner = vi.fn();
    const auditCreate = vi.fn();
    const { pages, links, audit } = makeRepos({
      pagesFindById,
      pagesDeleteByOwner,
      auditCreate,
    });

    const tool = createWikiDeleteTool(pages, links, audit, USER_ID);
    const res = await tool.execute({});

    expect(res.isError).toBe(true);
    expect(res.output).toBe('pageId required');
    expect(pagesFindById).not.toHaveBeenCalled();
    expect(pagesDeleteByOwner).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
