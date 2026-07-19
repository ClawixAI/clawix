import { describe, expect, it, vi } from 'vitest';

import { ApprovalDeliveryService } from '../approval-delivery.service.js';

const deps = () => ({
  pubsub: { publish: vi.fn(async () => undefined) },
  fanout: { create: vi.fn(async () => ({})) },
});

const promptInput = {
  approvalId: 'apr1',
  userId: 'u1',
  sessionId: 's1',
  toolName: 'wiki_delete',
  paramsSummary: { pageId: 'p1' },
  offeredScopes: ['allow_once', 'deny_once'] as const,
  reason: 'no_memory',
  expiresAt: new Date('2026-07-06T12:00:00Z'),
};

describe('ApprovalDeliveryService', () => {
  it('deliverPrompt publishes a prompt frame and a TOOL_APPROVAL bell notification', async () => {
    const d = deps();
    const svc = new ApprovalDeliveryService(d.pubsub as never, d.fanout as never);
    await svc.deliverPrompt(promptInput);
    expect(d.pubsub.publish).toHaveBeenCalledWith(
      expect.stringContaining('approval:frame'),
      expect.objectContaining({ kind: 'prompt', approvalId: 'apr1', sessionId: 's1' }),
    );
    expect(d.fanout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'u1',
        type: 'TOOL_APPROVAL',
        payload: expect.objectContaining({
          approvalId: 'apr1',
          offeredScopes: promptInput.offeredScopes,
        }),
      }),
    );
  });

  it('deliverPrompt with null sessionId throws (gate maps to no_channel)', async () => {
    const d = deps();
    const svc = new ApprovalDeliveryService(d.pubsub as never, d.fanout as never);
    await expect(svc.deliverPrompt({ ...promptInput, sessionId: null })).rejects.toThrow();
    expect(d.pubsub.publish).not.toHaveBeenCalled();
    expect(d.fanout.create).not.toHaveBeenCalled();
  });

  it('deliverNotice publishes a notice frame and a TOOL_APPROVAL bell notification', async () => {
    const d = deps();
    const svc = new ApprovalDeliveryService(d.pubsub as never, d.fanout as never);
    await svc.deliverNotice({
      approvalId: 'apr2',
      userId: 'u1',
      sessionId: 's1',
      toolName: 'wiki_delete',
      paramsSummary: { pageId: 'p1' },
      reason: 'standing_deny',
    });
    expect(d.pubsub.publish).toHaveBeenCalledWith(
      expect.stringContaining('approval:frame'),
      expect.objectContaining({ kind: 'notice', approvalId: 'apr2', reason: 'standing_deny' }),
    );
    expect(d.fanout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'u1',
        type: 'TOOL_APPROVAL',
        payload: expect.objectContaining({ approvalId: 'apr2' }),
      }),
    );
  });

  it('deliverNotice with null sessionId still publishes (only deliverPrompt fails closed on no_channel)', async () => {
    const d = deps();
    const svc = new ApprovalDeliveryService(d.pubsub as never, d.fanout as never);
    await svc.deliverNotice({
      approvalId: 'apr3',
      userId: 'u1',
      sessionId: null,
      toolName: 'wiki_delete',
      paramsSummary: {},
      reason: 'session_deny',
    });
    expect(d.pubsub.publish).toHaveBeenCalledWith(
      expect.stringContaining('approval:frame'),
      expect.objectContaining({ kind: 'notice', sessionId: null }),
    );
  });

  it('deliverResolved publishes without creating a notification', async () => {
    const d = deps();
    const svc = new ApprovalDeliveryService(d.pubsub as never, d.fanout as never);
    await svc.deliverResolved({
      approvalId: 'apr1',
      userId: 'u1',
      sessionId: 's1',
      status: 'APPROVED',
      scope: 'once',
    });
    expect(d.pubsub.publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'resolved', status: 'APPROVED' }),
    );
    expect(d.fanout.create).not.toHaveBeenCalled();
  });
});
