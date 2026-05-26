import { describe, it, expect, vi } from 'vitest';
import { createSessionSearchTool } from '../session-search.tool.js';
import type { SessionSearchService } from '../../../session-recall/session-search.service.js';

function makeService(results: unknown[] = []) {
  return { search: vi.fn().mockResolvedValue(results) } as unknown as SessionSearchService;
}

describe('session_search tool', () => {
  it('rejects a blank query without calling the service', async () => {
    const svc = makeService();
    const tool = createSessionSearchTool(svc, 'u1');
    const res = await tool.execute({ query: '   ' });
    expect(res.isError).toBe(true);
    expect(svc.search).not.toHaveBeenCalled();
  });

  it('passes the closure userId and clamps limit to [1, 25]', async () => {
    const svc = makeService();
    const tool = createSessionSearchTool(svc, 'user-xyz');
    await tool.execute({ query: 'deploy', limit: 9999 });
    expect(svc.search).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-xyz', query: 'deploy', limit: 25 }),
    );
  });

  it('forwards days when provided and omits it otherwise', async () => {
    const svc = makeService();
    const tool = createSessionSearchTool(svc, 'u1');
    await tool.execute({ query: 'x', days: 30 });
    expect(svc.search.mock.calls[0]![0]).toMatchObject({ days: 30 });

    const svc2 = makeService();
    const tool2 = createSessionSearchTool(svc2, 'u1');
    await tool2.execute({ query: 'x' });
    expect(svc2.search.mock.calls[0]![0].days).toBeUndefined();
  });

  it('floors and clamps days to a max of 365', async () => {
    const svc = makeService();
    const tool = createSessionSearchTool(svc, 'u1');
    await tool.execute({ query: 'x', days: 500.9 });
    expect(svc.search.mock.calls[0]![0]).toMatchObject({ days: 365 });
  });

  it('serializes results to JSON', async () => {
    const svc = makeService([
      { sessionId: 's1', title: 'T', relativeDate: '2 days ago', date: '2026-05-24', snippet: '…' },
    ]);
    const tool = createSessionSearchTool(svc, 'u1');
    const res = await tool.execute({ query: 'x' });
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.output)).toEqual([
      { sessionId: 's1', title: 'T', relativeDate: '2 days ago', date: '2026-05-24', snippet: '…' },
    ]);
  });
});
