import { describe, expect, it, vi } from 'vitest';

import { ApprovalsController } from '../approvals.controller.js';
import { ToolApprovalsController } from '../tool-approvals.controller.js';

const req = { user: { sub: 'u1' } } as never;

describe('ApprovalsController', () => {
  it('resolve delegates with the JWT user and 404s on failure', async () => {
    const svc = {
      resolve: vi.fn(async () => ({ ok: false, downgraded: false })),
      listPending: vi.fn(),
      revoke: vi.fn(),
    };
    const ctrl = new ApprovalsController(svc as never);
    await expect(ctrl.resolve('apr1', { choice: 'allow_once' }, req)).rejects.toThrow(/not found/i);
    expect(svc.resolve).toHaveBeenCalledWith('apr1', 'u1', 'allow_once');
  });

  it('resolve returns downgraded flag on success', async () => {
    const svc = {
      resolve: vi.fn(async () => ({ ok: true, downgraded: true })),
      listPending: vi.fn(),
      revoke: vi.fn(),
    };
    const ctrl = new ApprovalsController(svc as never);
    expect(await ctrl.resolve('apr1', { choice: 'deny_always' }, req)).toEqual({
      success: true,
      data: { downgraded: true },
    });
  });

  it('rejects an unknown choice with 400', async () => {
    const svc = { resolve: vi.fn(), listPending: vi.fn(), revoke: vi.fn() };
    const ctrl = new ApprovalsController(svc as never);
    await expect(ctrl.resolve('apr1', { choice: 'yolo' } as never, req)).rejects.toThrow(
      /invalid/i,
    );
    expect(svc.resolve).not.toHaveBeenCalled();
  });

  it('listPending delegates with the JWT user', async () => {
    const rows = [{ id: 'apr1' }];
    const svc = {
      resolve: vi.fn(),
      listPending: vi.fn(async () => rows),
      revoke: vi.fn(),
    };
    const ctrl = new ApprovalsController(svc as never);
    expect(await ctrl.listPending(req)).toEqual({ success: true, data: rows });
    expect(svc.listPending).toHaveBeenCalledWith('u1');
  });

  it('revoke delegates with the JWT user and 404s on failure', async () => {
    const svc = {
      resolve: vi.fn(),
      listPending: vi.fn(),
      revoke: vi.fn(async () => false),
    };
    const ctrl = new ApprovalsController(svc as never);
    await expect(ctrl.revoke('apr1', req)).rejects.toThrow(/not found/i);
    expect(svc.revoke).toHaveBeenCalledWith('apr1', 'u1');
  });

  it('revoke succeeds when the service reports removal', async () => {
    const svc = {
      resolve: vi.fn(),
      listPending: vi.fn(),
      revoke: vi.fn(async () => true),
    };
    const ctrl = new ApprovalsController(svc as never);
    expect(await ctrl.revoke('apr1', req)).toEqual({ success: true });
  });
});

describe('ToolApprovalsController', () => {
  it('list delegates with the JWT user', async () => {
    const rows = [{ id: 'row1' }];
    const repo = { listForUser: vi.fn(async () => rows), deleteById: vi.fn() };
    const audit = { create: vi.fn() };
    const ctrl = new ToolApprovalsController(repo as never, audit as never);
    expect(await ctrl.list(req)).toEqual({ success: true, data: rows });
    expect(repo.listForUser).toHaveBeenCalledWith('u1');
  });

  it('delete is identity-guarded through the repository', async () => {
    const repo = { listForUser: vi.fn(), deleteById: vi.fn(async () => false) };
    const audit = { create: vi.fn() };
    const ctrl = new ToolApprovalsController(repo as never, audit as never);
    await expect(ctrl.remove('row1', req)).rejects.toThrow(/not found/i);
    expect(repo.deleteById).toHaveBeenCalledWith('row1', 'u1');
    expect(audit.create).not.toHaveBeenCalled();
  });

  it('delete audits approval.revoke with source=settings on success', async () => {
    const repo = { listForUser: vi.fn(), deleteById: vi.fn(async () => true) };
    const audit = { create: vi.fn(async () => undefined) };
    const ctrl = new ToolApprovalsController(repo as never, audit as never);
    expect(await ctrl.remove('row1', req)).toEqual({ success: true });
    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        action: 'approval.revoke',
        resourceId: 'row1',
        details: expect.objectContaining({ source: 'settings' }),
      }),
    );
  });
});
