import { describe, it, expect, beforeEach, vi } from 'vitest';

import { WikiController } from '../wiki.controller.js';
import type { WikiService, WikiPageDto } from '../wiki.service.js';
import type { JwtPayload } from '../../auth/auth.types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAGE_DTO: WikiPageDto = {
  id: 'page-1',
  slug: 'my-page',
  title: 'My Page',
  summary: 'A summary',
  content: '# Hello',
  tags: ['domain:engineering'],
  scope: 'AMBIENT',
  isOrgShared: false,
  isOwned: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function makeUser(sub: string, role: 'admin' | 'developer' | 'viewer' = 'developer'): JwtPayload {
  return { sub, email: `${sub}@x.com`, role: role as never, policyName: 'free' };
}

function makeReq(user: JwtPayload) {
  return { user } as { user: JwtPayload };
}

function createMockService(): Partial<WikiService> {
  return {
    listPages: vi.fn().mockResolvedValue([PAGE_DTO]),
    getPage: vi.fn().mockResolvedValue(PAGE_DTO),
    createPage: vi.fn().mockResolvedValue(PAGE_DTO),
    updatePage: vi.fn().mockResolvedValue(PAGE_DTO),
    deletePage: vi.fn().mockResolvedValue(undefined),
    listBacklinks: vi.fn().mockResolvedValue([]),
    getSchema: vi.fn().mockResolvedValue({ content: '# Schema' }),
    updateSchema: vi.fn().mockResolvedValue(undefined),
    runLint: vi.fn().mockResolvedValue([]),
    sharePage: vi.fn().mockResolvedValue({ shareId: 'share-1' }),
    revokeShare: vi.fn().mockResolvedValue(undefined),
    revokeOrgShare: vi.fn().mockResolvedValue(undefined),
    getGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WikiController', () => {
  let svc: ReturnType<typeof createMockService>;
  let controller: WikiController;

  beforeEach(() => {
    svc = createMockService();
    controller = new WikiController(svc as unknown as WikiService);
  });

  // -------------------------------------------------------------------------
  // GET /wiki
  // -------------------------------------------------------------------------

  describe('list', () => {
    it('defaults ownership to "visible" when not provided', async () => {
      const result = await controller.list(makeReq(makeUser('u1')), undefined as never);

      expect(svc.listPages).toHaveBeenCalledWith('u1', {
        ownership: 'visible',
        tags: undefined,
        scope: undefined,
        query: undefined,
      });
      expect(result).toEqual([PAGE_DTO]);
    });

    it('passes ownership=mine when specified', async () => {
      await controller.list(makeReq(makeUser('u1')), 'mine');

      expect(svc.listPages).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ ownership: 'mine' }),
      );
    });

    it('parses comma-separated tags and forwards q + scope', async () => {
      await controller.list(
        makeReq(makeUser('u1')),
        'mine',
        'domain:hr,domain:engineering',
        'AMBIENT',
        'leave policy',
      );

      expect(svc.listPages).toHaveBeenCalledWith('u1', {
        ownership: 'mine',
        tags: ['domain:hr', 'domain:engineering'],
        scope: 'AMBIENT',
        query: 'leave policy',
      });
    });

    it('strips empty entries from tag list', async () => {
      await controller.list(makeReq(makeUser('u1')), 'visible', 'domain:hr,,  ');

      const call = vi.mocked(svc.listPages!).mock.calls[0]![1];
      expect(call.tags).toEqual(['domain:hr']);
    });

    it('treats unknown ownership value as "visible"', async () => {
      await controller.list(makeReq(makeUser('u1')), 'other' as never);

      expect(svc.listPages).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ ownership: 'visible' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // GET /wiki/schema
  // -------------------------------------------------------------------------

  describe('getSchema', () => {
    it('calls svc.getSchema with userId and returns content', async () => {
      const result = await controller.getSchema(makeReq(makeUser('u1')));

      expect(svc.getSchema).toHaveBeenCalledWith('u1');
      expect(result).toEqual({ content: '# Schema' });
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /wiki/schema
  // -------------------------------------------------------------------------

  describe('updateSchema', () => {
    it('calls svc.updateSchema and returns { ok: true }', async () => {
      const result = await controller.updateSchema(makeReq(makeUser('u1', 'admin')), {
        content: 'new schema',
      });

      expect(svc.updateSchema).toHaveBeenCalledWith('u1', 'new schema');
      expect(result).toEqual({ ok: true });
    });
  });

  // -------------------------------------------------------------------------
  // POST /wiki/lint
  // -------------------------------------------------------------------------

  describe('lint', () => {
    it('forwards checks to svc.runLint', async () => {
      vi.mocked(svc.runLint!).mockResolvedValue([
        { pageId: 'page-1', slug: 'my-page', finding: 'orphans', detail: 'no backlinks' },
      ]);

      const result = await controller.lint(makeReq(makeUser('u1', 'developer')), {
        checks: ['orphans'],
      });

      expect(svc.runLint).toHaveBeenCalledWith('u1', ['orphans'], undefined);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ finding: 'orphans' });
    });

    it('forwards maxResults to svc.runLint', async () => {
      await controller.lint(makeReq(makeUser('u1', 'admin')), {
        checks: ['missing-summaries'],
        maxResults: 5,
      });

      expect(svc.runLint).toHaveBeenCalledWith('u1', ['missing-summaries'], 5);
    });

    it('calls svc.runLint with empty body (no checks)', async () => {
      await controller.lint(makeReq(makeUser('u1')), {});

      expect(svc.runLint).toHaveBeenCalledWith('u1', undefined, undefined);
    });
  });

  // -------------------------------------------------------------------------
  // GET /wiki/graph
  // -------------------------------------------------------------------------

  describe('graph', () => {
    it('defaults ownership to "visible" when not provided', async () => {
      const result = await controller.graph(makeReq(makeUser('u1')), undefined as never);

      expect(svc.getGraph).toHaveBeenCalledWith('u1', { ownership: 'visible' });
      expect(result).toEqual({ nodes: [], edges: [] });
    });

    it('passes ownership=mine when specified', async () => {
      await controller.graph(makeReq(makeUser('u1')), 'mine');
      expect(svc.getGraph).toHaveBeenCalledWith('u1', { ownership: 'mine' });
    });

    it('treats unknown ownership value as "visible"', async () => {
      await controller.graph(makeReq(makeUser('u1')), 'garbage' as never);
      expect(svc.getGraph).toHaveBeenCalledWith('u1', { ownership: 'visible' });
    });

    it('returns the service result verbatim', async () => {
      const graph = {
        nodes: [
          {
            id: 'p1',
            slug: 'a',
            title: 'A',
            summary: 's',
            domain: 'hr',
            isDaily: false,
            scope: 'AMBIENT' as const,
            isOwned: true,
            isOrgShared: false,
          },
        ],
        edges: [],
      };
      (svc.getGraph as ReturnType<typeof vi.fn>).mockResolvedValueOnce(graph);

      const result = await controller.graph(makeReq(makeUser('u1')), 'mine');
      expect(result).toEqual(graph);
    });
  });

  // -------------------------------------------------------------------------
  // GET /wiki/:id
  // -------------------------------------------------------------------------

  describe('get', () => {
    it('calls svc.getPage with userId and id', async () => {
      const result = await controller.get(makeReq(makeUser('u1')), 'page-1');

      expect(svc.getPage).toHaveBeenCalledWith('u1', 'page-1');
      expect(result).toEqual(PAGE_DTO);
    });
  });

  // -------------------------------------------------------------------------
  // GET /wiki/:id/backlinks
  // -------------------------------------------------------------------------

  describe('backlinks', () => {
    it('calls svc.listBacklinks with userId and pageId', async () => {
      const backlink = { id: 'page-2', slug: 'other', title: 'Other', summary: 'ref' };
      vi.mocked(svc.listBacklinks!).mockResolvedValue([backlink]);

      const result = await controller.backlinks(makeReq(makeUser('u1')), 'page-1');

      expect(svc.listBacklinks).toHaveBeenCalledWith('u1', 'page-1');
      expect(result).toEqual([backlink]);
    });

    it('returns empty array when no backlinks exist', async () => {
      vi.mocked(svc.listBacklinks!).mockResolvedValue([]);

      const result = await controller.backlinks(makeReq(makeUser('u1')), 'page-1');

      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // POST /wiki
  // -------------------------------------------------------------------------

  describe('create', () => {
    it('calls svc.createPage with userId and validated body', async () => {
      const body = {
        title: 'New Page',
        summary: 'Summary text',
        content: '# New Page',
        tags: ['domain:hr'],
        scope: 'AMBIENT' as const,
      };

      const result = await controller.create(makeReq(makeUser('u1', 'developer')), body);

      expect(svc.createPage).toHaveBeenCalledWith('u1', body);
      expect(result).toEqual(PAGE_DTO);
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /wiki/:id
  // -------------------------------------------------------------------------

  describe('update', () => {
    it('calls svc.updatePage with userId, id, and validated body', async () => {
      const body = { title: 'Updated Title', content: '# Updated' };

      const result = await controller.update(makeReq(makeUser('u1', 'admin')), 'page-1', body);

      expect(svc.updatePage).toHaveBeenCalledWith('u1', 'page-1', body);
      expect(result).toEqual(PAGE_DTO);
    });

    it('accepts a partial update (only content changed)', async () => {
      const body = { content: 'new content only' };

      await controller.update(makeReq(makeUser('u1', 'developer')), 'page-1', body);

      expect(svc.updatePage).toHaveBeenCalledWith('u1', 'page-1', { content: 'new content only' });
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /wiki/:id
  // -------------------------------------------------------------------------

  describe('remove', () => {
    it('calls svc.deletePage and returns undefined (204)', async () => {
      const result = await controller.remove(makeReq(makeUser('u1', 'developer')), 'page-1');

      expect(svc.deletePage).toHaveBeenCalledWith('u1', 'page-1');
      expect(result).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // POST /wiki/:id/share
  // -------------------------------------------------------------------------

  describe('share', () => {
    it('calls svc.sharePage with org target and returns shareId', async () => {
      const body = { targetType: 'org' as const };

      const result = await controller.share(makeReq(makeUser('u1', 'admin')), 'page-1', body);

      expect(svc.sharePage).toHaveBeenCalledWith('u1', 'page-1', body);
      expect(result).toEqual({ shareId: 'share-1' });
    });

    it('calls svc.sharePage with group target', async () => {
      const body = { targetType: 'group' as const, groupId: 'grp-42' };
      vi.mocked(svc.sharePage!).mockResolvedValue({ shareId: 'share-grp-1' });

      const result = await controller.share(makeReq(makeUser('u1', 'developer')), 'page-1', body);

      expect(svc.sharePage).toHaveBeenCalledWith('u1', 'page-1', body);
      expect(result).toEqual({ shareId: 'share-grp-1' });
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /wiki/shares/:shareId
  // -------------------------------------------------------------------------

  describe('revokeShare', () => {
    it('calls svc.revokeShare and returns undefined (204)', async () => {
      const result = await controller.revokeShare(makeReq(makeUser('u1', 'developer')), 'share-1');

      expect(svc.revokeShare).toHaveBeenCalledWith('u1', 'share-1');
      expect(result).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /wiki/:id/org-share
  // -------------------------------------------------------------------------

  describe('revokeOrgShare', () => {
    it('calls svc.revokeOrgShare with userId and pageId and returns undefined (204)', async () => {
      const result = await controller.revokeOrgShare(makeReq(makeUser('u1', 'admin')), 'page-1');

      expect(svc.revokeOrgShare).toHaveBeenCalledWith('u1', 'page-1');
      expect(result).toBeUndefined();
    });
  });
});
