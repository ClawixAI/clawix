import { describe, it, expect, beforeEach } from 'vitest';

import type { PrismaService } from '../../prisma/prisma.service.js';
import { TokenUsageRepository } from '../token-usage.repository.js';
import { createMockPrismaService, type MockPrismaService } from './mock-prisma.js';

describe('TokenUsageRepository', () => {
  let repository: TokenUsageRepository;
  let mockPrisma: MockPrismaService;

  const mockTokenUsage = {
    id: 'tu-1',
    agentRunId: 'run-1',
    userId: 'user-1',
    model: 'claude-sonnet-4-20250514',
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    estimatedCostUsd: 0.015,
    createdAt: new Date('2026-01-15'),
  };

  const defaultPagination = { page: 1, limit: 10 };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    repository = new TokenUsageRepository(mockPrisma as unknown as PrismaService);
  });

  describe('findById', () => {
    it('should return token usage when found', async () => {
      mockPrisma.tokenUsage.findUnique.mockResolvedValue(mockTokenUsage);

      const result = await repository.findById('tu-1');

      expect(result).toEqual(mockTokenUsage);
      expect(mockPrisma.tokenUsage.findUnique).toHaveBeenCalledWith({
        where: { id: 'tu-1' },
      });
    });

    it('should throw NotFoundError when not found', async () => {
      mockPrisma.tokenUsage.findUnique.mockResolvedValue(null);

      await expect(repository.findById('missing')).rejects.toThrow('TokenUsage');
    });
  });

  describe('findByUserId', () => {
    it('should return paginated token usage for a user', async () => {
      mockPrisma.tokenUsage.findMany.mockResolvedValue([mockTokenUsage]);
      mockPrisma.tokenUsage.count.mockResolvedValue(1);

      const result = await repository.findByUserId('user-1', defaultPagination);

      expect(result.data).toEqual([mockTokenUsage]);
      expect(result.meta.total).toBe(1);
      expect(mockPrisma.tokenUsage.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findByAgentRunId', () => {
    it('should return all token usage for an agent run', async () => {
      mockPrisma.tokenUsage.findMany.mockResolvedValue([mockTokenUsage]);

      const result = await repository.findByAgentRunId('run-1');

      expect(result).toEqual([mockTokenUsage]);
      expect(mockPrisma.tokenUsage.findMany).toHaveBeenCalledWith({
        where: { agentRunId: 'run-1' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array when no records exist', async () => {
      mockPrisma.tokenUsage.findMany.mockResolvedValue([]);

      const result = await repository.findByAgentRunId('run-999');

      expect(result).toEqual([]);
    });
  });

  describe('findByDateRange', () => {
    it('should return paginated token usage within date range', async () => {
      const startDate = new Date('2026-01-01');
      const endDate = new Date('2026-01-31');
      mockPrisma.tokenUsage.findMany.mockResolvedValue([mockTokenUsage]);
      mockPrisma.tokenUsage.count.mockResolvedValue(1);

      const result = await repository.findByDateRange(startDate, endDate, defaultPagination);

      expect(result.data).toEqual([mockTokenUsage]);
      expect(mockPrisma.tokenUsage.findMany).toHaveBeenCalledWith({
        where: {
          createdAt: { gte: startDate, lte: endDate },
        },
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('create', () => {
    it('should create a token usage record with required fields', async () => {
      mockPrisma.tokenUsage.create.mockResolvedValue(mockTokenUsage);

      const result = await repository.create({
        agentRunId: 'run-1',
        userId: 'user-1',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      });

      expect(result).toEqual(mockTokenUsage);
      expect(mockPrisma.tokenUsage.create).toHaveBeenCalledWith({
        data: {
          agentRunId: 'run-1',
          userId: 'user-1',
          model: 'claude-sonnet-4-20250514',
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
        },
      });
    });

    it('should create a token usage record with estimatedCostUsd', async () => {
      mockPrisma.tokenUsage.create.mockResolvedValue(mockTokenUsage);

      await repository.create({
        agentRunId: 'run-1',
        userId: 'user-1',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        estimatedCostUsd: 0.015,
      });

      expect(mockPrisma.tokenUsage.create).toHaveBeenCalledWith({
        data: {
          agentRunId: 'run-1',
          userId: 'user-1',
          model: 'claude-sonnet-4-20250514',
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          estimatedCostUsd: 0.015,
        },
      });
    });

    it('should call handlePrismaError on failure', async () => {
      mockPrisma.tokenUsage.create.mockRejectedValue({
        code: 'P2002',
        meta: { target: ['id'] },
      });

      await expect(
        repository.create({
          agentRunId: 'run-1',
          userId: 'user-1',
          model: 'test',
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        }),
      ).rejects.toThrow();
    });
  });

  describe('sumByUserId', () => {
    it('should return aggregated token usage for a user', async () => {
      mockPrisma.tokenUsage.aggregate.mockResolvedValue({
        _sum: {
          inputTokens: 5000,
          outputTokens: 2500,
          totalTokens: 7500,
          cacheCreationTokens: 200,
          cacheReadTokens: 1000,
          estimatedCostUsd: 0.075,
        },
      });

      const startDate = new Date('2026-01-01');
      const endDate = new Date('2026-01-31');
      const result = await repository.sumByUserId('user-1', startDate, endDate);

      expect(result).toEqual({
        totalInputTokens: 5000,
        totalOutputTokens: 2500,
        totalTokens: 7500,
        totalCacheCreationTokens: 200,
        totalCacheReadTokens: 1000,
        totalEstimatedCostUsd: 0.075,
      });
      expect(mockPrisma.tokenUsage.aggregate).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          createdAt: { gte: startDate, lte: endDate },
        },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
          cacheCreationTokens: true,
          cacheReadTokens: true,
          estimatedCostUsd: true,
        },
      });
    });

    it('should return zeros when no records exist', async () => {
      mockPrisma.tokenUsage.aggregate.mockResolvedValue({
        _sum: {
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          cacheCreationTokens: null,
          cacheReadTokens: null,
          estimatedCostUsd: null,
        },
      });

      const result = await repository.sumByUserId(
        'user-1',
        new Date('2026-01-01'),
        new Date('2026-01-31'),
      );

      expect(result).toEqual({
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalCacheCreationTokens: 0,
        totalCacheReadTokens: 0,
        totalEstimatedCostUsd: 0,
      });
    });
  });

  describe('sumByModel', () => {
    it('should return grouped token usage by model', async () => {
      mockPrisma.tokenUsage.groupBy.mockResolvedValue([
        {
          model: 'claude-sonnet-4-20250514',
          _sum: { totalTokens: 10000, estimatedCostUsd: 0.1 },
        },
        {
          model: 'gpt-4o',
          _sum: { totalTokens: 5000, estimatedCostUsd: 0.05 },
        },
      ]);

      const startDate = new Date('2026-01-01');
      const endDate = new Date('2026-01-31');
      const result = await repository.sumByModel(startDate, endDate);

      expect(result).toEqual([
        {
          model: 'claude-sonnet-4-20250514',
          totalTokens: 10000,
          totalCostUsd: 0.1,
        },
        { model: 'gpt-4o', totalTokens: 5000, totalCostUsd: 0.05 },
      ]);
      expect(mockPrisma.tokenUsage.groupBy).toHaveBeenCalledWith({
        by: ['model'],
        where: {
          createdAt: { gte: startDate, lte: endDate },
        },
        _sum: {
          totalTokens: true,
          estimatedCostUsd: true,
        },
      });
    });

    it('should return empty array when no records exist', async () => {
      mockPrisma.tokenUsage.groupBy.mockResolvedValue([]);

      const result = await repository.sumByModel(new Date('2026-01-01'), new Date('2026-01-31'));

      expect(result).toEqual([]);
    });

    it('should handle null sums in groupBy results', async () => {
      mockPrisma.tokenUsage.groupBy.mockResolvedValue([
        {
          model: 'test-model',
          _sum: { totalTokens: null, estimatedCostUsd: null },
        },
      ]);

      const result = await repository.sumByModel(new Date('2026-01-01'), new Date('2026-01-31'));

      expect(result).toEqual([{ model: 'test-model', totalTokens: 0, totalCostUsd: 0 }]);
    });
  });

  describe('immutability', () => {
    it('should not expose an update method', () => {
      expect((repository as unknown as Record<string, unknown>)['update']).toBeUndefined();
    });

    it('should not expose a delete method', () => {
      expect((repository as unknown as Record<string, unknown>)['delete']).toBeUndefined();
    });
  });

  describe('TokenUsageRepository — cache fields', () => {
    it('persists cache token counts on create', async () => {
      const mockWithCache = {
        ...mockTokenUsage,
        cacheCreationTokens: 0,
        cacheReadTokens: 5120,
        totalTokens: 5270,
        estimatedCostUsd: 0.42,
      };
      mockPrisma.tokenUsage.create.mockResolvedValue(mockWithCache);

      const created = await repository.create({
        agentRunId: 'run-1',
        userId: 'user-1',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 5270,
        cacheCreationTokens: 0,
        cacheReadTokens: 5120,
        estimatedCostUsd: 0.42,
      });

      expect(created.cacheCreationTokens).toBe(0);
      expect(created.cacheReadTokens).toBe(5120);
      expect(mockPrisma.tokenUsage.create).toHaveBeenCalledWith({
        data: {
          agentRunId: 'run-1',
          userId: 'user-1',
          model: 'claude-sonnet-4-20250514',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 5270,
          cacheCreationTokens: 0,
          cacheReadTokens: 5120,
          estimatedCostUsd: 0.42,
        },
      });
    });

    it('defaults cache token counts to 0 when omitted', async () => {
      mockPrisma.tokenUsage.create.mockResolvedValue(mockTokenUsage);

      const created = await repository.create({
        agentRunId: 'run-1',
        userId: 'user-1',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });

      expect(created.cacheCreationTokens).toBe(0);
      expect(created.cacheReadTokens).toBe(0);
      expect(mockPrisma.tokenUsage.create).toHaveBeenCalledWith({
        data: {
          agentRunId: 'run-1',
          userId: 'user-1',
          model: 'claude-sonnet-4-20250514',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
      });
    });

    it('includes cache token sums in sumByUserId', async () => {
      mockPrisma.tokenUsage.aggregate.mockResolvedValue({
        _sum: {
          inputTokens: 20,
          outputTokens: 20,
          totalTokens: 6040,
          cacheCreationTokens: 1000,
          cacheReadTokens: 5000,
          estimatedCostUsd: null,
        },
      });

      const sum = await repository.sumByUserId(
        'user-1',
        new Date(Date.now() - 60_000),
        new Date(Date.now() + 60_000),
      );

      expect(sum.totalCacheCreationTokens).toBe(1000);
      expect(sum.totalCacheReadTokens).toBe(5000);
    });
  });
});
