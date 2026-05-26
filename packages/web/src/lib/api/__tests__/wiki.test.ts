import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wikiApi } from '../wiki';
import * as authMod from '@/lib/auth';

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof authMod>();
  return { ...actual, authFetch: vi.fn() };
});

describe('wikiApi', () => {
  beforeEach(() => {
    vi.mocked(authMod.authFetch).mockReset();
  });

  describe('list', () => {
    it('uses bare /memory path when called with no args', async () => {
      vi.mocked(authMod.authFetch).mockResolvedValue([] as never);
      await wikiApi.list();
      expect(authMod.authFetch).toHaveBeenCalledWith('/memory');
    });

    it('composes query string with all params', async () => {
      vi.mocked(authMod.authFetch).mockResolvedValue([] as never);
      await wikiApi.list({ ownership: 'mine', tags: ['domain:hr'], q: 'leave', scope: 'AMBIENT' });
      expect(authMod.authFetch).toHaveBeenCalledTimes(1);
      const url = vi.mocked(authMod.authFetch).mock.calls[0]![0] as string;
      expect(url).toContain('/memory?');
      expect(url).toContain('ownership=mine');
      expect(url).toContain('tags=domain%3Ahr');
      expect(url).toContain('q=leave');
      expect(url).toContain('scope=AMBIENT');
    });

    it('omits empty tags array from query string', async () => {
      vi.mocked(authMod.authFetch).mockResolvedValue([] as never);
      await wikiApi.list({ ownership: 'visible', tags: [] });
      const url = vi.mocked(authMod.authFetch).mock.calls[0]![0] as string;
      expect(url).not.toContain('tags=');
    });
  });

  describe('get', () => {
    it('GETs /memory/:id with URL encoding', async () => {
      vi.mocked(authMod.authFetch).mockResolvedValue({ id: 'p1' } as never);
      await wikiApi.get('cuid-1');
      expect(authMod.authFetch).toHaveBeenCalledWith('/memory/cuid-1');
    });
  });

  describe('create', () => {
    it('POSTs to /memory with JSON body', async () => {
      vi.mocked(authMod.authFetch).mockResolvedValue({ id: 'p1' } as never);
      const input = { title: 'My Page', summary: 'A summary', content: 'Hello world' };
      await wikiApi.create(input);
      expect(authMod.authFetch).toHaveBeenCalledWith(
        '/memory',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(input),
        }),
      );
    });
  });

  describe('update', () => {
    it('PATCHes /memory/:id with JSON body', async () => {
      vi.mocked(authMod.authFetch).mockResolvedValue({ id: 'p1' } as never);
      const input = { content: 'updated content' };
      await wikiApi.update('cuid-1', input);
      expect(authMod.authFetch).toHaveBeenCalledWith(
        '/memory/cuid-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(input),
        }),
      );
    });
  });

  describe('delete', () => {
    it('DELETEs /memory/:id', async () => {
      vi.mocked(authMod.authFetch).mockResolvedValue(undefined as never);
      await wikiApi.delete('cuid-1');
      expect(authMod.authFetch).toHaveBeenCalledWith('/memory/cuid-1', { method: 'DELETE' });
    });
  });

  describe('share', () => {
    it('POSTs org share target to /memory/:id/share', async () => {
      vi.mocked(authMod.authFetch).mockResolvedValue({ shareId: 's1' } as never);
      const target = { targetType: 'org' as const };
      await wikiApi.share('p1', target);
      expect(authMod.authFetch).toHaveBeenCalledWith(
        '/memory/p1/share',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(target),
        }),
      );
    });

    it('POSTs group share target to /memory/:id/share', async () => {
      vi.mocked(authMod.authFetch).mockResolvedValue({ shareId: 's2' } as never);
      const target = { targetType: 'group' as const, groupId: 'g1' };
      await wikiApi.share('p2', target);
      expect(authMod.authFetch).toHaveBeenCalledWith(
        '/memory/p2/share',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(target),
        }),
      );
    });
  });

  describe('revokeShare', () => {
    it('DELETEs /memory/shares/:shareId', async () => {
      vi.mocked(authMod.authFetch).mockResolvedValue(undefined as never);
      await wikiApi.revokeShare('share-123');
      expect(authMod.authFetch).toHaveBeenCalledWith('/memory/shares/share-123', {
        method: 'DELETE',
      });
    });
  });

  describe('unshareOrg', () => {
    it('DELETEs /memory/:id/org-share', async () => {
      vi.mocked(authMod.authFetch).mockResolvedValue(undefined as never);
      await wikiApi.unshareOrg('page-abc');
      expect(authMod.authFetch).toHaveBeenCalledWith('/memory/page-abc/org-share', {
        method: 'DELETE',
      });
    });
  });

  describe('backlinks', () => {
    it('GETs /memory/:id/backlinks', async () => {
      vi.mocked(authMod.authFetch).mockResolvedValue([] as never);
      await wikiApi.backlinks('p1');
      expect(authMod.authFetch).toHaveBeenCalledWith('/memory/p1/backlinks');
    });
  });

  describe('getSchema', () => {
    it('GETs /memory/schema', async () => {
      vi.mocked(authMod.authFetch).mockResolvedValue({ content: 'schema content' } as never);
      await wikiApi.getSchema();
      expect(authMod.authFetch).toHaveBeenCalledWith('/memory/schema');
    });
  });

  describe('updateSchema', () => {
    it('PATCHes /memory/schema with content body', async () => {
      vi.mocked(authMod.authFetch).mockResolvedValue({ ok: true } as never);
      await wikiApi.updateSchema('new schema content');
      expect(authMod.authFetch).toHaveBeenCalledWith(
        '/memory/schema',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ content: 'new schema content' }),
        }),
      );
    });
  });

  describe('lint', () => {
    it('POSTs to /memory/lint with checks array', async () => {
      vi.mocked(authMod.authFetch).mockResolvedValue([] as never);
      await wikiApi.lint(['orphans', 'broken-links']);
      expect(authMod.authFetch).toHaveBeenCalledWith(
        '/memory/lint',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ checks: ['orphans', 'broken-links'] }),
        }),
      );
    });

    it('POSTs to /memory/lint with undefined checks when none provided', async () => {
      vi.mocked(authMod.authFetch).mockResolvedValue([] as never);
      await wikiApi.lint();
      expect(authMod.authFetch).toHaveBeenCalledWith(
        '/memory/lint',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ checks: undefined }),
        }),
      );
    });
  });

  describe('graph', () => {
    it('GETs /memory/graph?ownership=visible by default', async () => {
      vi.mocked(authMod.authFetch).mockResolvedValue({ nodes: [], edges: [] } as never);
      await wikiApi.graph();
      expect(authMod.authFetch).toHaveBeenCalledWith('/memory/graph?ownership=visible');
    });

    it('passes ownership=mine through', async () => {
      vi.mocked(authMod.authFetch).mockResolvedValue({ nodes: [], edges: [] } as never);
      await wikiApi.graph({ ownership: 'mine' });
      expect(authMod.authFetch).toHaveBeenCalledWith('/memory/graph?ownership=mine');
    });
  });
});
