import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundError, ConflictError } from '@clawix/shared';

import { PolicyRepository } from '../policy.repository.js';
import { createMockPrismaService, type MockPrismaService } from './mock-prisma.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

describe('PolicyRepository', () => {
  let repo: PolicyRepository;
  let mockPrisma: MockPrismaService;

  const mockPolicy = {
    id: 'policy-1',
    name: 'Extended',
    description: 'Extended policy',
    maxTokenBudget: 10000,
    maxAgents: 10,
    maxSkills: 20,
    maxGroupsOwned: 10,
    allowedProviders: ['anthropic', 'openai'],
    features: {},
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const pagination = { page: 1, limit: 20 };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    repo = new PolicyRepository(mockPrisma as unknown as PrismaService);
  });

  describe('findById', () => {
    it('should return policy when found', async () => {
      mockPrisma.policy.findUnique.mockResolvedValue(mockPolicy);

      const result = await repo.findById('policy-1');

      expect(result).toEqual(mockPolicy);
    });

    it('should throw NotFoundError when not found', async () => {
      mockPrisma.policy.findUnique.mockResolvedValue(null);

      await expect(repo.findById('missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('findAll', () => {
    it('should return paginated policies', async () => {
      mockPrisma.policy.count.mockResolvedValue(1);
      mockPrisma.policy.findMany.mockResolvedValue([mockPolicy]);

      const result = await repo.findAll(pagination);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
    });
  });

  describe('findByName', () => {
    it('should return policy by name', async () => {
      mockPrisma.policy.findUnique.mockResolvedValue(mockPolicy);

      const result = await repo.findByName('Extended');

      expect(result).toEqual(mockPolicy);
    });

    it('should return null when name not found', async () => {
      mockPrisma.policy.findUnique.mockResolvedValue(null);

      const result = await repo.findByName('NonExistent');

      expect(result).toBeNull();
    });
  });

  describe('findActive', () => {
    it('should return only active policies', async () => {
      mockPrisma.policy.count.mockResolvedValue(1);
      mockPrisma.policy.findMany.mockResolvedValue([mockPolicy]);

      const result = await repo.findActive(pagination);

      expect(result.data).toHaveLength(1);
      expect(mockPrisma.policy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });
  });

  describe('create', () => {
    it('should create a policy', async () => {
      mockPrisma.policy.create.mockResolvedValue(mockPolicy);

      const result = await repo.create({ name: 'Extended' });

      expect(result).toEqual(mockPolicy);
    });

    it('should throw ConflictError on duplicate name', async () => {
      mockPrisma.policy.create.mockRejectedValue({ code: 'P2002', meta: { target: ['name'] } });

      await expect(repo.create({ name: 'Extended' })).rejects.toThrow(ConflictError);
    });
  });

  describe('update', () => {
    it('should update a policy', async () => {
      const updated = { ...mockPolicy, name: 'Unrestricted' };
      mockPrisma.policy.update.mockResolvedValue(updated);

      const result = await repo.update('policy-1', { name: 'Unrestricted' });

      expect(result.name).toBe('Unrestricted');
    });

    it('should update with only one field and omit all other optional fields from data', async () => {
      mockPrisma.policy.update.mockResolvedValue(mockPolicy);

      await repo.update('policy-1', { maxAgents: 50 });

      expect(mockPrisma.policy.update).toHaveBeenCalledWith({
        where: { id: 'policy-1' },
        data: { maxAgents: 50 },
      });
    });

    it('should persist allowMcp through the whitelist', async () => {
      mockPrisma.policy.update.mockResolvedValue({ ...mockPolicy, allowMcp: true });

      await repo.update('policy-1', { allowMcp: true });

      expect(mockPrisma.policy.update).toHaveBeenCalledWith({
        where: { id: 'policy-1' },
        data: { allowMcp: true },
      });
    });

    it('should throw NotFoundError when updating non-existent policy', async () => {
      mockPrisma.policy.update.mockRejectedValue({ code: 'P2025' });

      await expect(repo.update('missing', { name: 'X' })).rejects.toThrow(NotFoundError);
    });
  });

  describe('delete', () => {
    it('should delete a policy', async () => {
      mockPrisma.policy.delete.mockResolvedValue(mockPolicy);

      const result = await repo.delete('policy-1');

      expect(result).toEqual(mockPolicy);
    });

    it('should throw NotFoundError when deleting non-existent policy', async () => {
      mockPrisma.policy.delete.mockRejectedValue({ code: 'P2025' });

      await expect(repo.delete('missing')).rejects.toThrow(NotFoundError);
    });

    it('should throw ConflictError on delete with constraint violation', async () => {
      mockPrisma.policy.delete.mockRejectedValue({
        code: 'P2002',
        meta: { target: ['id'] },
      });

      await expect(repo.delete('policy-1')).rejects.toThrow(ConflictError);
    });
  });
});
