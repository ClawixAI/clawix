import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { ToolApprovalService } from '../tool-approval.service.js';

function makeService(overrides: { deliverPromptFails?: boolean } = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  let nextId = 0;
  const approvalRepo = {
    create: vi.fn(async (input: Record<string, unknown>) => {
      const id = `apr${++nextId}`;
      rows.set(id, { id, status: 'PENDING', ...input });
      return rows.get(id);
    }),
    findById: vi.fn(async (id: string) => rows.get(id) ?? null),
    listPendingForUser: vi.fn(async () => []),
    transitionStatus: vi.fn(async (id: string, from: string, patch: Record<string, unknown>) => {
      const row = rows.get(id);
      if (!row || row['status'] !== from) return false;
      Object.assign(row, patch, { resolvedAt: new Date() });
      return true;
    }),
    expireAllPending: vi.fn(async () => 0),
  };
  const userToolApprovalRepo = {
    findForKeys: vi.fn(async () => []),
    upsert: vi.fn(async (i: Record<string, unknown>) => ({ id: 'uta1', ...i })),
    deleteByKey: vi.fn(async () => true),
  };
  const auditRepo = { create: vi.fn(async () => ({})) };
  const delivery = {
    deliverPrompt: overrides.deliverPromptFails
      ? vi.fn(async () => {
          throw new Error('no adapter');
        })
      : vi.fn(async () => undefined),
    deliverNotice: vi.fn(async () => undefined),
    deliverResolved: vi.fn(async () => undefined),
  };
  const runActivity = { recordToolStart: vi.fn(), recordToolEnd: vi.fn() };
  const svc = new ToolApprovalService(
    userToolApprovalRepo as never,
    approvalRepo as never,
    auditRepo as never,
    delivery as never,
    runActivity as never,
  );
  return { svc, approvalRepo, userToolApprovalRepo, auditRepo, delivery, rows };
}

const gateInput = {
  userId: 'u1',
  agentRunId: 'run1',
  sessionId: 's1',
  isSubAgent: false,
  toolName: 'wiki_delete',
  scopeKind: 'resource' as const,
  resourceKey: 'page-a',
  extractorFailed: false,
  params: { pageId: 'page-a' },
};

describe('gate — rendezvous', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('allow_once resolves the wait, writes no memory', async () => {
    const { svc, approvalRepo, userToolApprovalRepo, delivery } = makeService();
    const gatePromise = svc.gate(gateInput);
    await vi.waitFor(() => expect(delivery.deliverPrompt).toHaveBeenCalled());
    const approvalId = delivery.deliverPrompt.mock.calls[0]?.[0]?.approvalId as string;

    const res = await svc.resolve(approvalId, 'u1', 'allow_once');
    expect(res).toEqual({ ok: true, downgraded: false });
    expect(await gatePromise).toEqual({ allowed: true });
    expect(userToolApprovalRepo.upsert).not.toHaveBeenCalled();
    expect(approvalRepo.transitionStatus).toHaveBeenCalledWith(
      approvalId,
      'PENDING',
      expect.objectContaining({ status: 'APPROVED', scope: 'once' }),
    );
  });

  it('deny_always writes persistent deny with memoryStore/memoryKey stamped', async () => {
    const { svc, delivery, userToolApprovalRepo, rows } = makeService();
    const gatePromise = svc.gate(gateInput);
    await vi.waitFor(() => expect(delivery.deliverPrompt).toHaveBeenCalled());
    const approvalId = delivery.deliverPrompt.mock.calls[0]?.[0]?.approvalId as string;

    await svc.resolve(approvalId, 'u1', 'deny_always');
    const result = await gatePromise;
    expect(result.allowed).toBe(false);
    expect(userToolApprovalRepo.upsert).toHaveBeenCalledWith({
      userId: 'u1',
      toolName: 'wiki_delete',
      resourceKey: 'page-a',
      decision: 'denied',
    });
    expect(rows.get(approvalId)).toMatchObject({
      memoryStore: 'persistent',
      memoryKey: 'wiki_delete:page-a',
      scope: 'always',
    });
  });

  it('timeout expires the row, blocks, writes no memory', async () => {
    const { svc, delivery, userToolApprovalRepo, rows } = makeService();
    const gatePromise = svc.gate(gateInput);
    await vi.waitFor(() => expect(delivery.deliverPrompt).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(300_001);
    const result = await gatePromise;
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.blockedMessage).toContain('Silence is not consent');
    expect(userToolApprovalRepo.upsert).not.toHaveBeenCalled();
    const row = [...rows.values()][0];
    expect(row).toMatchObject({ status: 'EXPIRED', resolutionReason: 'timeout' });
  });

  it('abort signal cancels the pending request', async () => {
    const { svc, delivery, rows } = makeService();
    const controller = new AbortController();
    const gatePromise = svc.gate({ ...gateInput, abortSignal: controller.signal });
    await vi.waitFor(() => expect(delivery.deliverPrompt).toHaveBeenCalled());
    controller.abort();
    const result = await gatePromise;
    expect(result.allowed).toBe(false);
    expect([...rows.values()][0]).toMatchObject({
      status: 'CANCELLED',
      resolutionReason: 'run_aborted',
    });
  });

  it('pre-aborted signal short-circuits gate without waiting for timeout', async () => {
    const { svc, delivery, userToolApprovalRepo, rows } = makeService();
    const controller = new AbortController();
    controller.abort(); // Abort BEFORE calling gate()
    const gatePromise = svc.gate({ ...gateInput, abortSignal: controller.signal });
    const result = await gatePromise;
    expect(result.allowed).toBe(false);
    expect([...rows.values()][0]).toMatchObject({
      status: 'CANCELLED',
      resolutionReason: 'run_aborted',
    });
    // Verify no memory was written (no upsert call)
    expect(userToolApprovalRepo.upsert).not.toHaveBeenCalled();
    // Verify it settled immediately (didn't wait for timeout)
    expect(delivery.deliverPrompt).toHaveBeenCalled();
  });

  it('resolve after timeout loses the race (atomic transition)', async () => {
    const { svc, delivery } = makeService();
    const gatePromise = svc.gate(gateInput);
    await vi.waitFor(() => expect(delivery.deliverPrompt).toHaveBeenCalled());
    const approvalId = delivery.deliverPrompt.mock.calls[0]?.[0]?.approvalId as string;
    await vi.advanceTimersByTimeAsync(300_001);
    await gatePromise;
    expect((await svc.resolve(approvalId, 'u1', 'allow_once')).ok).toBe(false);
  });

  it('foreign user cannot resolve', async () => {
    const { svc, delivery } = makeService();
    const gatePromise = svc.gate(gateInput);
    await vi.waitFor(() => expect(delivery.deliverPrompt).toHaveBeenCalled());
    const approvalId = delivery.deliverPrompt.mock.calls[0]?.[0]?.approvalId as string;
    expect((await svc.resolve(approvalId, 'attacker', 'allow_once')).ok).toBe(false);
    // still resolvable by the owner afterwards
    expect((await svc.resolve(approvalId, 'u1', 'deny_once')).ok).toBe(true);
    await gatePromise;
  });

  it('sub-agent gate auto-denies without prompting and writes no memory', async () => {
    const { svc, delivery, rows, userToolApprovalRepo } = makeService();
    const result = await svc.gate({ ...gateInput, isSubAgent: true });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.blockedMessage).toContain('sub-agents cannot request');
    expect(delivery.deliverPrompt).not.toHaveBeenCalled();
    expect(userToolApprovalRepo.upsert).not.toHaveBeenCalled();
    expect([...rows.values()][0]).toMatchObject({
      status: 'DENIED',
      resolutionReason: 'subagent',
    });
  });

  it('sub-agent honors existing session allow (memory flows via shared sessionId)', async () => {
    const { svc } = makeService();
    svc.writeSessionMemory('s1', 'wiki_delete', 'page-a', 'allow');
    expect(await svc.gate({ ...gateInput, isSubAgent: true })).toEqual({ allowed: true });
  });

  it('standing persistent deny → immediate pre-resolved DENIED row + notice, no prompt', async () => {
    const made = makeService();
    made.userToolApprovalRepo.findForKeys.mockResolvedValue([
      {
        id: 'r1',
        userId: 'u1',
        toolName: 'wiki_delete',
        resourceKey: 'page-a',
        decision: 'denied',
      },
    ]);
    const result = await made.svc.gate(gateInput);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.blockedMessage).toContain('standing denial');
    expect(made.delivery.deliverNotice).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'standing_deny' }),
    );
    expect(made.delivery.deliverPrompt).not.toHaveBeenCalled();
    expect([...made.rows.values()][0]).toMatchObject({
      status: 'DENIED',
      resolutionReason: 'standing_deny',
      scope: 'always',
      memoryStore: 'persistent',
      memoryKey: 'wiki_delete:page-a',
    });
  });

  it('delivery failure → no_channel auto-deny, no memory', async () => {
    const { svc, rows } = makeService({ deliverPromptFails: true });
    const result = await svc.gate(gateInput);
    expect(result.allowed).toBe(false);
    expect([...rows.values()][0]).toMatchObject({
      status: 'DENIED',
      resolutionReason: 'no_channel',
    });
  });

  it('null sessionId (cron) → no_channel auto-deny without attempting delivery', async () => {
    const { svc, delivery } = makeService();
    const result = await svc.gate({ ...gateInput, sessionId: null });
    expect(result.allowed).toBe(false);
    expect(delivery.deliverPrompt).not.toHaveBeenCalled();
  });

  it('revoke removes exactly the entry the row references (server-trusted, client key ignored)', async () => {
    const { svc, delivery, userToolApprovalRepo } = makeService();
    const gatePromise = svc.gate(gateInput);
    await vi.waitFor(() => expect(delivery.deliverPrompt).toHaveBeenCalled());
    const approvalId = delivery.deliverPrompt.mock.calls[0]?.[0]?.approvalId as string;
    await svc.resolve(approvalId, 'u1', 'deny_always');
    await gatePromise;

    expect(await svc.revoke(approvalId, 'u1')).toBe(true);
    expect(userToolApprovalRepo.deleteByKey).toHaveBeenCalledWith('u1', 'wiki_delete', 'page-a');
    expect(await svc.revoke(approvalId, 'attacker')).toBe(false);
  });

  it('session-scoped revoke removes session entry; subsequent lookup returns prompt', async () => {
    const { svc, delivery } = makeService();
    const gatePromise = svc.gate(gateInput);
    await vi.waitFor(() => expect(delivery.deliverPrompt).toHaveBeenCalled());
    const approvalId = delivery.deliverPrompt.mock.calls[0]?.[0]?.approvalId as string;

    // Resolve with deny_session to write a session entry
    await svc.resolve(approvalId, 'u1', 'deny_session');
    await gatePromise;

    // Verify the session memory holds the deny
    let result = await svc.lookup({
      userId: 'u1',
      sessionId: 's1',
      toolName: 'wiki_delete',
      resourceKey: 'page-a',
      extractorFailed: false,
    });
    expect(result.kind).toBe('deny');
    if (result.kind === 'deny') {
      expect(result.hit).toMatchObject({ store: 'session', scope: 'session' });
    }

    // Revoke the session entry
    expect(await svc.revoke(approvalId, 'u1')).toBe(true);

    // Verify the session entry is gone; lookup now returns prompt
    result = await svc.lookup({
      userId: 'u1',
      sessionId: 's1',
      toolName: 'wiki_delete',
      resourceKey: 'page-a',
      extractorFailed: false,
    });
    expect(result.kind).toBe('prompt');
  });
});
