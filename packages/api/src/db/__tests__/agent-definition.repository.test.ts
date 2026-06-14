import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundError, ConflictError } from '@clawix/shared';

import { AgentDefinitionRepository } from '../agent-definition.repository.js';
import { createMockPrismaService, type MockPrismaService } from './mock-prisma.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

describe('AgentDefinitionRepository', () => {
  let repo: AgentDefinitionRepository;
  let mockPrisma: MockPrismaService;

  const mockAgent = {
    id: 'agent-1',
    name: 'Research Agent',
    description: 'Performs web research',
    systemPrompt: 'You are a research agent.',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiBaseUrl: null,
    skillIds: ['skill-1'],
    maxTokensPerRun: 100000,
    containerConfig: {},
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const pagination = { page: 1, limit: 20 };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    repo = new AgentDefinitionRepository(mockPrisma as unknown as PrismaService);
  });

  describe('findById', () => {
    it('should return agent definition when found', async () => {
      mockPrisma.agentDefinition.findUnique.mockResolvedValue(mockAgent);

      const result = await repo.findById('agent-1');

      expect(result).toEqual(mockAgent);
    });

    it('should throw NotFoundError when not found', async () => {
      mockPrisma.agentDefinition.findUnique.mockResolvedValue(null);

      await expect(repo.findById('missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('findAll', () => {
    it('should return paginated agent definitions', async () => {
      mockPrisma.agentDefinition.count.mockResolvedValue(1);
      mockPrisma.agentDefinition.findMany.mockResolvedValue([mockAgent]);

      const result = await repo.findAll(pagination);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
    });
  });

  describe('findActive', () => {
    it('should return only active agent definitions', async () => {
      mockPrisma.agentDefinition.count.mockResolvedValue(1);
      mockPrisma.agentDefinition.findMany.mockResolvedValue([mockAgent]);

      const result = await repo.findActive(pagination);

      expect(result.data).toHaveLength(1);
      expect(mockPrisma.agentDefinition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });
  });

  describe('countByCreator', () => {
    it('counts agent definitions owned by the given user', async () => {
      mockPrisma.agentDefinition.count.mockResolvedValue(3);

      const result = await repo.countByCreator('user-1');

      expect(result).toBe(3);
      expect(mockPrisma.agentDefinition.count).toHaveBeenCalledWith({
        where: { createdById: 'user-1' },
      });
    });
  });

  describe('create', () => {
    it('should create an agent definition', async () => {
      mockPrisma.agentDefinition.create.mockResolvedValue(mockAgent);

      const result = await repo.create({ name: 'Research Agent' });

      expect(result).toEqual(mockAgent);
    });

    it('should create with only required fields and omit all optional fields from data', async () => {
      mockPrisma.agentDefinition.create.mockResolvedValue(mockAgent);

      await repo.create({ name: 'Minimal Agent' });

      expect(mockPrisma.agentDefinition.create).toHaveBeenCalledWith({
        data: { name: 'Minimal Agent' },
      });
    });

    it('should throw ConflictError on duplicate constraint', async () => {
      mockPrisma.agentDefinition.create.mockRejectedValue({
        code: 'P2002',
        meta: { target: ['name'] },
      });

      await expect(repo.create({ name: 'Research Agent' })).rejects.toThrow(ConflictError);
    });
  });

  describe('update', () => {
    it('should update an agent definition', async () => {
      const updated = { ...mockAgent, name: 'Updated Agent' };
      mockPrisma.agentDefinition.update.mockResolvedValue(updated);

      const result = await repo.update('agent-1', { name: 'Updated Agent' });

      expect(result.name).toBe('Updated Agent');
    });

    it('should update with minimal data and omit all other fields from data', async () => {
      mockPrisma.agentDefinition.update.mockResolvedValue(mockAgent);

      await repo.update('agent-1', { isActive: false });

      expect(mockPrisma.agentDefinition.update).toHaveBeenCalledWith({
        where: { id: 'agent-1' },
        data: { isActive: false },
      });
    });

    it('should throw NotFoundError when updating non-existent agent', async () => {
      mockPrisma.agentDefinition.update.mockRejectedValue({ code: 'P2025' });

      await expect(repo.update('missing', { name: 'X' })).rejects.toThrow(NotFoundError);
    });
  });

  describe('delete', () => {
    it('should delete an agent definition', async () => {
      mockPrisma.agentDefinition.delete.mockResolvedValue(mockAgent);

      const result = await repo.delete('agent-1');

      expect(result).toEqual(mockAgent);
    });

    it('should throw NotFoundError when deleting non-existent agent', async () => {
      mockPrisma.agentDefinition.delete.mockRejectedValue({ code: 'P2025' });

      await expect(repo.delete('missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('findOrCreateDefaultWorker', () => {
    const existingWorker = {
      ...mockAgent,
      id: 'agent-default-worker',
      name: 'default-worker',
      role: 'worker',
      provider: 'openai',
      model: 'gpt-4o',
    };

    it('returns existing row unchanged when its provider is enabled', async () => {
      mockPrisma.agentDefinition.findFirst.mockResolvedValue(existingWorker);
      mockPrisma.providerConfig.findFirst.mockResolvedValueOnce({
        id: 'pc-1',
        provider: 'openai',
        isEnabled: true,
      });

      const result = await repo.findOrCreateDefaultWorker();

      expect(result).toEqual(existingWorker);
      expect(mockPrisma.agentDefinition.update).not.toHaveBeenCalled();
      expect(mockPrisma.agentDefinition.create).not.toHaveBeenCalled();
      // Only the matching-provider lookup; the default lookup is not needed.
      expect(mockPrisma.providerConfig.findFirst).toHaveBeenCalledTimes(1);
      expect(mockPrisma.providerConfig.findFirst).toHaveBeenCalledWith({
        where: { provider: 'openai', isEnabled: true },
      });
    });

    it('heals existing row in place when its provider is not configured', async () => {
      const staleWorker = {
        ...existingWorker,
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
      };
      const healedWorker = { ...staleWorker, provider: 'openai', model: 'gpt-4o' };
      mockPrisma.agentDefinition.findFirst.mockResolvedValue(staleWorker);
      // First lookup: anthropic is not configured.
      mockPrisma.providerConfig.findFirst.mockResolvedValueOnce(null);
      // Second lookup: default provider is openai.
      mockPrisma.providerConfig.findFirst.mockResolvedValueOnce({
        id: 'pc-1',
        provider: 'openai',
        isEnabled: true,
        isDefault: true,
      });
      mockPrisma.agentDefinition.update.mockResolvedValue(healedWorker);

      const result = await repo.findOrCreateDefaultWorker();

      expect(result).toEqual(healedWorker);
      expect(mockPrisma.agentDefinition.update).toHaveBeenCalledWith({
        where: { id: staleWorker.id },
        data: { provider: 'openai', model: 'gpt-4o' },
      });
      expect(mockPrisma.agentDefinition.create).not.toHaveBeenCalled();
    });

    it('creates a new row when no default-worker exists', async () => {
      mockPrisma.agentDefinition.findFirst.mockResolvedValue(null);
      mockPrisma.providerConfig.findFirst.mockResolvedValueOnce({
        id: 'pc-1',
        provider: 'openai',
        isEnabled: true,
        isDefault: true,
      });
      const created = { ...existingWorker, id: 'newly-created' };
      mockPrisma.agentDefinition.create.mockResolvedValue(created);

      const result = await repo.findOrCreateDefaultWorker();

      expect(result).toEqual(created);
      expect(mockPrisma.agentDefinition.update).not.toHaveBeenCalled();
      expect(mockPrisma.agentDefinition.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'default-worker',
          role: 'worker',
          provider: 'openai',
          model: 'gpt-4o',
        }),
      });
    });

    it('throws an actionable error when no default ProviderConfig exists', async () => {
      mockPrisma.agentDefinition.findFirst.mockResolvedValue(null);
      mockPrisma.providerConfig.findFirst.mockResolvedValue(null);

      await expect(repo.findOrCreateDefaultWorker()).rejects.toThrow(
        /No default provider configured/,
      );
    });

    it('throws when the default provider is not in the registry (e.g., custom provider)', async () => {
      mockPrisma.agentDefinition.findFirst.mockResolvedValue(null);
      mockPrisma.providerConfig.findFirst.mockResolvedValueOnce({
        id: 'pc-custom',
        provider: 'my-private-llm',
        isEnabled: true,
        isDefault: true,
      });

      await expect(repo.findOrCreateDefaultWorker()).rejects.toThrow(
        /not in the provider registry/,
      );
    });
  });
});
