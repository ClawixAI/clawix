import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundError, ConflictError } from '@clawix/shared';

import type { PrismaService } from '../../prisma/prisma.service.js';

import { ProviderConfigRepository } from '../provider-config.repository.js';
import { createMockPrismaService, type MockPrismaService } from './mock-prisma.js';

describe('ProviderConfigRepository', () => {
  let repository: ProviderConfigRepository;
  let mockPrisma: MockPrismaService;

  const mockConfig = {
    id: 'pc-1',
    provider: 'anthropic',
    apiKey: 'sk-ant-xxx',
    apiBaseUrl: null,
    isDefault: true,
    createdAt: new Date(),
  };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    repository = new ProviderConfigRepository(mockPrisma as unknown as PrismaService);
  });

  describe('findById', () => {
    it('should return a provider config when found', async () => {
      mockPrisma.providerConfig.findUnique.mockResolvedValue(mockConfig);

      const result = await repository.findById('pc-1');

      expect(result).toEqual(mockConfig);
      expect(mockPrisma.providerConfig.findUnique).toHaveBeenCalledWith({ where: { id: 'pc-1' } });
    });

    it('should throw NotFoundError when not found', async () => {
      mockPrisma.providerConfig.findUnique.mockResolvedValue(null);

      await expect(repository.findById('missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      mockPrisma.providerConfig.findMany.mockResolvedValue([mockConfig]);
      mockPrisma.providerConfig.count.mockResolvedValue(1);

      const result = await repository.findAll({ page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
    });
  });

  describe('findByProvider', () => {
    it('should return config when found', async () => {
      mockPrisma.providerConfig.findUnique.mockResolvedValue(mockConfig);

      const result = await repository.findByProvider('anthropic');

      expect(result).toEqual(mockConfig);
      expect(mockPrisma.providerConfig.findUnique).toHaveBeenCalledWith({
        where: { provider: 'anthropic' },
      });
    });

    it('should return null when not found', async () => {
      mockPrisma.providerConfig.findUnique.mockResolvedValue(null);

      const result = await repository.findByProvider('unknown');

      expect(result).toBeNull();
    });
  });

  describe('findDefault', () => {
    it('should return default config when found', async () => {
      mockPrisma.providerConfig.findFirst.mockResolvedValue(mockConfig);

      const result = await repository.findDefault();

      expect(result).toEqual(mockConfig);
      expect(mockPrisma.providerConfig.findFirst).toHaveBeenCalledWith({
        where: { isDefault: true },
      });
    });

    it('should return null when no default exists', async () => {
      mockPrisma.providerConfig.findFirst.mockResolvedValue(null);

      const result = await repository.findDefault();

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a provider config', async () => {
      mockPrisma.providerConfig.create.mockResolvedValue(mockConfig);

      const result = await repository.create({
        provider: 'anthropic',
        displayName: 'Anthropic',
        apiKey: 'sk-ant-xxx',
      });

      expect(result).toEqual(mockConfig);
    });

    it('should throw ConflictError on duplicate provider', async () => {
      mockPrisma.providerConfig.create.mockRejectedValue({
        code: 'P2002',
        meta: { target: ['provider'] },
      });

      await expect(
        repository.create({ provider: 'anthropic', displayName: 'Anthropic', apiKey: 'key' }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('update', () => {
    it('should update a provider config', async () => {
      const updated = { ...mockConfig, isDefault: false };
      mockPrisma.providerConfig.update.mockResolvedValue(updated);

      const result = await repository.update('pc-1', { isDefault: false });

      expect(result.isDefault).toBe(false);
    });

    it('should throw NotFoundError when updating non-existent config', async () => {
      mockPrisma.providerConfig.update.mockRejectedValue({ code: 'P2025' });

      await expect(repository.update('missing', { apiKey: 'new-key' })).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('delete', () => {
    it('should delete a provider config', async () => {
      mockPrisma.providerConfig.delete.mockResolvedValue(mockConfig);

      const result = await repository.delete('pc-1');

      expect(result).toEqual(mockConfig);
    });

    it('should throw NotFoundError when deleting non-existent config', async () => {
      mockPrisma.providerConfig.delete.mockRejectedValue({ code: 'P2025' });

      await expect(repository.delete('missing')).rejects.toThrow(NotFoundError);
    });
  });
});
