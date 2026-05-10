import { describe, it, expect, beforeEach, vi } from 'vitest';

import { MemoryController } from '../memory.controller.js';
import type { MemoryService } from '../memory.service.js';
import type { JwtPayload } from '../../auth/auth.types.js';

const mockItem = {
  id: 'mem-1',
  ownerId: 'user-A',
  content: 'hello',
  tags: ['domain:hr'],
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeUser(sub: string, role: 'admin' | 'developer' | 'viewer' = 'developer'): JwtPayload {
  return { sub, email: `${sub}@x.com`, role: role as never, policyName: 'free' };
}

function createMockService() {
  return {
    list: vi.fn().mockResolvedValue([]),
    read: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

describe('MemoryController', () => {
  let svc: ReturnType<typeof createMockService>;
  let controller: MemoryController;

  beforeEach(() => {
    svc = createMockService();
    controller = new MemoryController(svc as unknown as MemoryService);
  });

  describe('list', () => {
    it('GET /memory?scope=mine delegates with the caller userId', async () => {
      svc.list.mockResolvedValue([mockItem]);

      const result = await controller.list({ scope: 'mine' }, { user: makeUser('user-A') });

      expect(svc.list).toHaveBeenCalledWith('user-A', 'mine');
      expect(result).toEqual({ items: [mockItem] });
    });

    it('GET /memory?scope=visible delegates with the caller userId', async () => {
      svc.list.mockResolvedValue([mockItem]);

      await controller.list({ scope: 'visible' }, { user: makeUser('user-A') });

      expect(svc.list).toHaveBeenCalledWith('user-A', 'visible');
    });
  });

  describe('read', () => {
    it('GET /memory/:id delegates to service.read', async () => {
      svc.read.mockResolvedValue(mockItem);

      const result = await controller.read('mem-1', { user: makeUser('user-A') });

      expect(svc.read).toHaveBeenCalledWith('mem-1', 'user-A');
      expect(result).toEqual(mockItem);
    });
  });

  describe('create', () => {
    it('POST /memory delegates to service.create with role', async () => {
      svc.create.mockResolvedValue(mockItem);

      const result = await controller.create(
        { content: 'hello', tags: ['domain:hr'] },
        { user: makeUser('user-A', 'admin') },
      );

      expect(svc.create).toHaveBeenCalledWith('user-A', 'admin', {
        content: 'hello',
        tags: ['domain:hr'],
      });
      expect(result).toEqual(mockItem);
    });
  });

  describe('update', () => {
    it('PATCH /memory/:id delegates to service.update with role', async () => {
      svc.update.mockResolvedValue(mockItem);

      const result = await controller.update(
        'mem-1',
        { content: 'new' },
        { user: makeUser('user-A', 'developer') },
      );

      expect(svc.update).toHaveBeenCalledWith('mem-1', 'user-A', 'developer', { content: 'new' });
      expect(result).toEqual(mockItem);
    });
  });

  describe('delete', () => {
    it('DELETE /memory/:id delegates to service.delete', async () => {
      const result = await controller.delete('mem-1', { user: makeUser('user-A') });

      expect(svc.delete).toHaveBeenCalledWith('mem-1', 'user-A');
      expect(result).toBeUndefined();
    });
  });
});
