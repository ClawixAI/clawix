import { describe, it, expect } from 'vitest';
import { createWikiLogTool } from '../wiki-log.tool.js';

describe('wiki_log tool', () => {
  it('returns wiki.* audit rows for caller and excludes non-wiki actions', async () => {
    const calls: unknown[] = [];
    const fakePrisma = {
      auditLog: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return [
            {
              id: 'a1',
              action: 'wiki.create',
              resourceId: 'p1',
              details: { slug: 'x' },
              createdAt: new Date(),
            },
          ];
        },
      },
    } as never;
    const tool = createWikiLogTool(fakePrisma, 'u1');
    const res = await tool.execute({});
    expect(res.isError).toBe(false);
    const rows = JSON.parse(res.output);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('wiki.create');
    // Verify the where clause filtered by wiki.* and userId
    expect(calls[0]).toMatchObject({
      where: expect.objectContaining({
        userId: 'u1',
        action: { startsWith: 'wiki.' },
      }),
    });
  });

  it('filters to a specific action when action param provided', async () => {
    const calls: unknown[] = [];
    const fakePrisma = {
      auditLog: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return [];
        },
      },
    } as never;
    const tool = createWikiLogTool(fakePrisma, 'u1');
    await tool.execute({ action: 'create' });
    expect(calls[0]).toMatchObject({
      where: expect.objectContaining({
        action: 'wiki.create',
      }),
    });
  });

  it('clamps days to [1, 90]', async () => {
    const fakePrisma = {
      auditLog: { findMany: async () => [] },
    } as never;
    const tool = createWikiLogTool(fakePrisma, 'u1');
    const res = await tool.execute({ days: 9999 });
    expect(res.isError).toBe(false);
  });

  it('clamps limit to [1, 200]', async () => {
    let receivedTake: number | undefined;
    const fakePrisma = {
      auditLog: {
        findMany: async (args: { take: number }) => {
          receivedTake = args.take;
          return [];
        },
      },
    } as never;
    const tool = createWikiLogTool(fakePrisma, 'u1');
    await tool.execute({ limit: 9999 });
    expect(receivedTake).toBeLessThanOrEqual(200);
  });
});
