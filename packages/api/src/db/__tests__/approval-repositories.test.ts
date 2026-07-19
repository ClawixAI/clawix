import { describe, expect, it, vi } from 'vitest';

import { ApprovalRequestRepository } from '../approval-request.repository.js';
import { UserToolApprovalRepository } from '../user-tool-approval.repository.js';

const prismaMock = () =>
  ({
    approvalRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    userToolApproval: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  }) as never;

describe('ApprovalRequestRepository', () => {
  it('transitionStatus guards on the from-status and reports success', async () => {
    const prisma = prismaMock();
    (prisma as any).approvalRequest.updateMany.mockResolvedValue({ count: 1 });
    const repo = new ApprovalRequestRepository(prisma);

    const ok = await repo.transitionStatus('apr1', 'PENDING', {
      status: 'APPROVED',
      scope: 'once',
    });

    expect(ok).toBe(true);
    expect((prisma as any).approvalRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'apr1', status: 'PENDING' },
      data: expect.objectContaining({
        status: 'APPROVED',
        scope: 'once',
        resolvedAt: expect.any(Date),
      }),
    });
  });

  it('transitionStatus returns false when the row already left the from-status', async () => {
    const prisma = prismaMock();
    (prisma as any).approvalRequest.updateMany.mockResolvedValue({ count: 0 });
    const repo = new ApprovalRequestRepository(prisma);
    expect(await repo.transitionStatus('apr1', 'PENDING', { status: 'DENIED' })).toBe(false);
  });

  it('expireAllPending stamps reason and returns count', async () => {
    const prisma = prismaMock();
    (prisma as any).approvalRequest.updateMany.mockResolvedValue({ count: 3 });
    const repo = new ApprovalRequestRepository(prisma);
    expect(await repo.expireAllPending('restart_sweep')).toBe(3);
    expect((prisma as any).approvalRequest.updateMany).toHaveBeenCalledWith({
      where: { status: 'PENDING' },
      data: expect.objectContaining({ status: 'EXPIRED', resolutionReason: 'restart_sweep' }),
    });
  });
});

describe('UserToolApprovalRepository', () => {
  it('deleteById is recipient-guarded', async () => {
    const prisma = prismaMock();
    (prisma as any).userToolApproval.deleteMany.mockResolvedValue({ count: 0 });
    const repo = new UserToolApprovalRepository(prisma);
    expect(await repo.deleteById('row1', 'other-user')).toBe(false);
    expect((prisma as any).userToolApproval.deleteMany).toHaveBeenCalledWith({
      where: { id: 'row1', userId: 'other-user' },
    });
  });

  it('findForKeys queries both specificity levels in one call', async () => {
    const prisma = prismaMock();
    (prisma as any).userToolApproval.findMany.mockResolvedValue([]);
    const repo = new UserToolApprovalRepository(prisma);
    await repo.findForKeys('u1', 'wiki_delete', ['page-a', '']);
    expect((prisma as any).userToolApproval.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', toolName: 'wiki_delete', resourceKey: { in: ['page-a', ''] } },
    });
  });
});
