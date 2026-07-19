import { describe, expect, it, vi, afterEach } from 'vitest';

import { ToolApprovalService } from '../tool-approval.service.js';

// Minimal fakes: only what lookup touches.
function makeService(persistentRows: { resourceKey: string; decision: string }[]) {
  const userToolApprovalRepo = {
    findForKeys: vi.fn().mockResolvedValue(
      persistentRows.map((r, i) => ({
        id: `row${i}`,
        userId: 'u1',
        toolName: 'wiki_delete',
        ...r,
      })),
    ),
  };
  const svc = new ToolApprovalService(
    userToolApprovalRepo as never,
    // Task 5 adds more deps; keep constructor order stable: see implementation.
    ...([] as never[]),
  );
  return { svc, userToolApprovalRepo };
}

const base = {
  userId: 'u1',
  sessionId: 's1',
  toolName: 'wiki_delete',
  resourceKey: 'page-a',
  extractorFailed: false,
};

describe('precedence truth table (spec §5)', () => {
  it('no entries anywhere → prompt(no_memory)', async () => {
    const { svc } = makeService([]);
    expect(await svc.lookup(base)).toEqual({ kind: 'prompt', reason: 'no_memory' });
  });

  it('resource-level persistent deny beats run-level allow', async () => {
    const { svc } = makeService([
      { resourceKey: 'page-a', decision: 'denied' },
      { resourceKey: '', decision: 'allowed' },
    ]);
    const r = await svc.lookup(base);
    expect(r.kind).toBe('deny');
    if (r.kind === 'deny') expect(r.hit).toMatchObject({ store: 'persistent', scope: 'always' });
  });

  it('resource-level allow beats run-level deny (more-specific wins)', async () => {
    const { svc } = makeService([
      { resourceKey: 'page-a', decision: 'allowed' },
      { resourceKey: '', decision: 'denied' },
    ]);
    expect((await svc.lookup(base)).kind).toBe('allow');
  });

  it('equal specificity: session deny beats persistent allow (deny wins across stores)', async () => {
    const { svc } = makeService([{ resourceKey: 'page-a', decision: 'allowed' }]);
    svc.writeSessionMemory('s1', 'wiki_delete', 'page-a', 'deny');
    const r = await svc.lookup(base);
    expect(r.kind).toBe('deny');
    if (r.kind === 'deny') expect(r.hit).toMatchObject({ store: 'session', scope: 'session' });
  });

  it('session allow at resource level short-circuits without persistent rows', async () => {
    const { svc } = makeService([]);
    svc.writeSessionMemory('s1', 'wiki_delete', 'page-a', 'allow');
    expect((await svc.lookup(base)).kind).toBe('allow');
  });

  it('run-level session deny fires when no resource-level entries exist', async () => {
    const { svc } = makeService([]);
    svc.writeSessionMemory('s1', 'wiki_delete', '', 'deny');
    expect((await svc.lookup(base)).kind).toBe('deny');
  });

  it('null sessionId consults only persistent rows', async () => {
    const { svc } = makeService([{ resourceKey: '', decision: 'allowed' }]);
    expect((await svc.lookup({ ...base, sessionId: null })).kind).toBe('allow');
  });

  it('extractorFailed → prompt(extractor_error), memory not consulted at resource level', async () => {
    const { svc } = makeService([]);
    const r = await svc.lookup({ ...base, resourceKey: '', extractorFailed: true });
    expect(r).toEqual({ kind: 'prompt', reason: 'extractor_error' });
  });

  it('clearSessionMemory evaporates session entries', async () => {
    const { svc } = makeService([]);
    svc.writeSessionMemory('s1', 'wiki_delete', 'page-a', 'deny');
    svc.clearSessionMemory('s1');
    expect((await svc.lookup(base)).kind).toBe('prompt');
  });
});

describe('session TTL (spec §4)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sliding renewal: read at ~23h renews; entry still hits at >24h-from-write but <24h-from-touch', async () => {
    vi.useFakeTimers();
    const { svc } = makeService([]);

    // Write entry at t=0
    const now = new Date('2026-01-01T00:00:00Z').getTime();
    vi.setSystemTime(now);
    svc.writeSessionMemory('s1', 'wiki_delete', 'page-a', 'allow');

    // Advance ~23h and read (should hit and refresh touchedAt)
    vi.advanceTimersByTime(23 * 60 * 60 * 1000);
    const r1 = await svc.lookup(base);
    expect(r1.kind).toBe('allow');

    // Advance another ~23h (total >24h from write, but <24h from the refresh read)
    vi.advanceTimersByTime(23 * 60 * 60 * 1000);
    const r2 = await svc.lookup(base);
    // Entry should still hit because the touch in the previous read refreshed the TTL
    expect(r2.kind).toBe('allow');
  });

  it('eviction: read after >24h with no intervening touch → entry expired, returns prompt', async () => {
    vi.useFakeTimers();
    const { svc } = makeService([]);

    // Write entry at t=0
    const now = new Date('2026-01-01T00:00:00Z').getTime();
    vi.setSystemTime(now);
    svc.writeSessionMemory('s1', 'wiki_delete', 'page-a', 'deny');

    // Advance >24h without reading
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1000);

    // Lookup should return prompt (entry expired and evicted)
    const r = await svc.lookup(base);
    expect(r).toEqual({ kind: 'prompt', reason: 'no_memory' });
  });
});
