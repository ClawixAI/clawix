import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundError, ConflictError } from '@clawix/shared';

import type { PrismaService } from '../../prisma/prisma.service.js';

import { AgentRunRepository } from '../agent-run.repository.js';
import { createMockPrismaService, type MockPrismaService } from './mock-prisma.js';

describe('AgentRunRepository', () => {
  let repository: AgentRunRepository;
  let mockPrisma: MockPrismaService;

  const mockAgentRun = {
    id: 'run-1',
    agentDefinitionId: 'agent-1',
    sessionId: 'session-1',
    status: 'idle',
    input: 'test input',
    output: null,
    error: null,
    tokenUsage: {},
    startedAt: new Date(),
    completedAt: null,
  };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    repository = new AgentRunRepository(mockPrisma as unknown as PrismaService);
  });

  describe('findById', () => {
    it('should return an agent run when found', async () => {
      mockPrisma.agentRun.findUnique.mockResolvedValue(mockAgentRun);

      const result = await repository.findById('run-1');

      expect(result).toEqual(mockAgentRun);
      expect(mockPrisma.agentRun.findUnique).toHaveBeenCalledWith({ where: { id: 'run-1' } });
    });

    it('should throw NotFoundError when not found', async () => {
      mockPrisma.agentRun.findUnique.mockResolvedValue(null);

      await expect(repository.findById('missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      mockPrisma.agentRun.findMany.mockResolvedValue([mockAgentRun]);
      mockPrisma.agentRun.count.mockResolvedValue(1);

      const result = await repository.findAll({ page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
    });
  });

  describe('findByStatus', () => {
    it('should filter by status', async () => {
      mockPrisma.agentRun.findMany.mockResolvedValue([mockAgentRun]);
      mockPrisma.agentRun.count.mockResolvedValue(1);

      const result = await repository.findByStatus('idle', { page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(mockPrisma.agentRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'idle' } }),
      );
    });
  });

  describe('findBySessionId', () => {
    it('should filter by sessionId', async () => {
      mockPrisma.agentRun.findMany.mockResolvedValue([mockAgentRun]);
      mockPrisma.agentRun.count.mockResolvedValue(1);

      const result = await repository.findBySessionId('session-1', { page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(mockPrisma.agentRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { sessionId: 'session-1' } }),
      );
    });
  });

  describe('findByAgentDefinitionId', () => {
    it('should filter by agentDefinitionId', async () => {
      mockPrisma.agentRun.findMany.mockResolvedValue([mockAgentRun]);
      mockPrisma.agentRun.count.mockResolvedValue(1);

      const result = await repository.findByAgentDefinitionId('agent-1', { page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(mockPrisma.agentRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { agentDefinitionId: 'agent-1' } }),
      );
    });

    it('should additionally scope by session.userId when userId is provided', async () => {
      mockPrisma.agentRun.findMany.mockResolvedValue([mockAgentRun]);
      mockPrisma.agentRun.count.mockResolvedValue(1);

      await repository.findByAgentDefinitionId('agent-1', { page: 1, limit: 10 }, 'user-1');

      expect(mockPrisma.agentRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { agentDefinitionId: 'agent-1', session: { userId: 'user-1' } },
        }),
      );
      expect(mockPrisma.agentRun.count).toHaveBeenCalledWith({
        where: { agentDefinitionId: 'agent-1', session: { userId: 'user-1' } },
      });
    });
  });

  describe('create', () => {
    it('should create an agent run', async () => {
      mockPrisma.agentRun.create.mockResolvedValue(mockAgentRun);

      const result = await repository.create({
        agentDefinitionId: 'agent-1',
        sessionId: 'session-1',
        input: 'test input',
      });

      expect(result).toEqual(mockAgentRun);
    });

    it('should create with only required fields and omit status from data', async () => {
      mockPrisma.agentRun.create.mockResolvedValue(mockAgentRun);

      await repository.create({
        agentDefinitionId: 'agent-1',
        sessionId: 'session-1',
        input: 'test input',
      });

      expect(mockPrisma.agentRun.create).toHaveBeenCalledWith({
        data: {
          agentDefinitionId: 'agent-1',
          sessionId: 'session-1',
          input: 'test input',
        },
      });
    });

    it('should include parentAgentRunId in data when provided', async () => {
      const childRun = { ...mockAgentRun, id: 'run-2', parentAgentRunId: 'run-1' };
      mockPrisma.agentRun.create.mockResolvedValue(childRun);

      await repository.create({
        agentDefinitionId: 'agent-1',
        sessionId: 'session-1',
        input: 'child input',
        parentAgentRunId: 'run-1',
      });

      expect(mockPrisma.agentRun.create).toHaveBeenCalledWith({
        data: {
          agentDefinitionId: 'agent-1',
          sessionId: 'session-1',
          input: 'child input',
          parentAgentRunId: 'run-1',
        },
      });
    });

    it('should omit parentAgentRunId from data when not provided', async () => {
      mockPrisma.agentRun.create.mockResolvedValue(mockAgentRun);

      await repository.create({
        agentDefinitionId: 'agent-1',
        sessionId: 'session-1',
        input: 'test input',
      });

      expect(mockPrisma.agentRun.create).toHaveBeenCalledWith({
        data: expect.not.objectContaining({ parentAgentRunId: expect.anything() }),
      });
    });

    it('should throw ConflictError on duplicate', async () => {
      mockPrisma.agentRun.create.mockRejectedValue({ code: 'P2002', meta: { target: ['id'] } });

      await expect(
        repository.create({ agentDefinitionId: 'a', sessionId: 's', input: 'i' }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('findByParentId', () => {
    it('should return child runs ordered by startedAt asc', async () => {
      const child1 = { ...mockAgentRun, id: 'run-2', parentAgentRunId: 'run-1' };
      const child2 = { ...mockAgentRun, id: 'run-3', parentAgentRunId: 'run-1' };
      mockPrisma.agentRun.findMany.mockResolvedValue([child1, child2]);

      const result = await repository.findByParentId('run-1');

      expect(result).toHaveLength(2);
      expect(mockPrisma.agentRun.findMany).toHaveBeenCalledWith({
        where: { parentAgentRunId: 'run-1' },
        orderBy: { startedAt: 'asc' },
      });
    });

    it('should return an empty array when no child runs exist', async () => {
      mockPrisma.agentRun.findMany.mockResolvedValue([]);

      const result = await repository.findByParentId('run-nonexistent');

      expect(result).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('should update an agent run', async () => {
      const updated = { ...mockAgentRun, status: 'completed' };
      mockPrisma.agentRun.update.mockResolvedValue(updated);

      const result = await repository.update('run-1', { status: 'completed' });

      expect(result.status).toBe('completed');
    });

    it('should update with minimal data and omit all other fields from data', async () => {
      const updated = { ...mockAgentRun, output: 'result' };
      mockPrisma.agentRun.update.mockResolvedValue(updated);

      await repository.update('run-1', { output: 'result' });

      expect(mockPrisma.agentRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: { output: 'result' },
      });
    });

    it('should throw NotFoundError when updating non-existent run', async () => {
      mockPrisma.agentRun.update.mockRejectedValue({ code: 'P2025' });

      await expect(repository.update('missing', { status: 'failed' })).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should reset startedAt when transitioning to running so the execution clock matches the watchdog', async () => {
      // The pending row is created with startedAt at creation time; a sub-agent
      // may then wait in the executor queue. Anchoring startedAt to the
      // running transition keeps the stale-run reaper's clock aligned with the
      // executor watchdog and reasoning-loop timeout (all execution-anchored),
      // so the watchdog fires before the reaper instead of the reverse.
      mockPrisma.agentRun.update.mockResolvedValue({ ...mockAgentRun, status: 'running' });

      await repository.update('run-1', { status: 'running' });

      expect(mockPrisma.agentRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: { status: 'running', startedAt: expect.any(Date) },
      });
    });

    it('should NOT touch startedAt for non-running transitions', async () => {
      mockPrisma.agentRun.update.mockResolvedValue({ ...mockAgentRun, status: 'completed' });

      await repository.update('run-1', { status: 'completed', output: 'done' });

      expect(mockPrisma.agentRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: { status: 'completed', output: 'done' },
      });
    });
  });

  describe('delete', () => {
    it('should delete an agent run', async () => {
      mockPrisma.agentRun.delete.mockResolvedValue(mockAgentRun);

      const result = await repository.delete('run-1');

      expect(result).toEqual(mockAgentRun);
    });

    it('should throw NotFoundError when deleting non-existent run', async () => {
      mockPrisma.agentRun.delete.mockRejectedValue({ code: 'P2025' });

      await expect(repository.delete('missing')).rejects.toThrow(NotFoundError);
    });
  });
});
