import { describe, it, expect } from 'vitest';
import { createWikiIndexTool } from '../wiki-index.tool.js';

describe('wiki_index tool', () => {
  const baseRows = [
    {
      id: 'p1',
      slug: 'a',
      title: 'A',
      summary: 'aaa',
      tags: ['domain:hr'],
      scope: 'ARCHIVED' as const,
      ownerId: 'u1',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'p2',
      slug: 'b',
      title: 'B',
      summary: 'bbb',
      tags: ['domain:eng'],
      scope: 'ARCHIVED' as const,
      ownerId: 'u1',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  function makeRepo(rows: typeof baseRows) {
    const calls: { method: string; args: unknown }[] = [];
    return {
      calls,
      findVisibleToUser: async (
        _userId: string,
        opts?: { tags?: readonly string[]; scope?: string; limit?: number },
      ) => {
        calls.push({ method: 'findVisibleToUser', args: opts });
        let out = rows;
        if (opts?.tags?.length)
          out = out.filter((p) => opts.tags!.every((t) => p.tags.includes(t)));
        if (opts?.scope) out = out.filter((p) => p.scope === opts.scope);
        return out.slice(0, opts?.limit ?? 200);
      },
      listOwnedByUser: async (
        _ownerId: string,
        opts?: { tags?: readonly string[]; scope?: string; limit?: number },
      ) => {
        calls.push({ method: 'listOwnedByUser', args: opts });
        let out = rows.filter((p) => p.ownerId === 'u1');
        if (opts?.tags?.length)
          out = out.filter((p) => opts.tags!.every((t) => p.tags.includes(t)));
        if (opts?.scope) out = out.filter((p) => p.scope === opts.scope);
        return out.slice(0, opts?.limit ?? 200);
      },
    };
  }

  it('returns id/slug/title/summary/tags/scope/isOwned for each visible page', async () => {
    const repo = makeRepo(baseRows);
    const tool = createWikiIndexTool(repo as never, 'u1');
    const res = await tool.execute({});
    expect(res.isError).toBe(false);
    const parsed = JSON.parse(res.output);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      id: expect.any(String),
      slug: expect.any(String),
      title: expect.any(String),
      summary: expect.any(String),
      tags: expect.any(Array),
      scope: expect.any(String),
      isOwned: true,
    });
  });

  it('filters by tags', async () => {
    const repo = makeRepo(baseRows);
    const tool = createWikiIndexTool(repo as never, 'u1');
    const res = await tool.execute({ tags: ['domain:hr'] });
    const parsed = JSON.parse(res.output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe('A');
  });

  it("ownership 'mine' routes to listOwnedByUser instead of findVisibleToUser", async () => {
    const repo = makeRepo(baseRows);
    const tool = createWikiIndexTool(repo as never, 'u1');
    await tool.execute({ ownership: 'mine' });
    const methodCalled = repo.calls[repo.calls.length - 1].method;
    expect(methodCalled).toBe('listOwnedByUser');
  });

  it('clamps limit to 200 (does not error on larger inputs)', async () => {
    const repo = makeRepo(baseRows);
    const tool = createWikiIndexTool(repo as never, 'u1');
    const res = await tool.execute({ limit: 5000 });
    expect(res.isError).toBe(false);
    // Verify the repository was called with the clamped limit, not 5000
    const lastCall = repo.calls[repo.calls.length - 1].args as { limit?: number };
    expect(lastCall.limit).toBeLessThanOrEqual(200);
  });
});
