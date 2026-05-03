import { describe, it, expect, beforeEach } from 'vitest';

import type { PrismaService } from '../../prisma/prisma.service.js';
import { SessionRepository } from '../session.repository.js';
import { createMockPrismaService, type MockPrismaService } from './mock-prisma.js';

describe('SessionRepository', () => {
  let repository: SessionRepository;
  let mockPrisma: MockPrismaService;

  const mockSession = {
    id: 'sess-1',
    userId: 'user-1',
    agentDefinitionId: 'agent-1',
    channelId: 'ch-1',
    lastConsolidatedAt: null,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    repository = new SessionRepository(mockPrisma as unknown as PrismaService);
  });

  describe('findById', () => {
    it('should return session when found', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(mockSession);

      const result = await repository.findById('sess-1');

      expect(result).toEqual(mockSession);
      expect(mockPrisma.session.findUnique).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
      });
    });

    it('should throw NotFoundError when not found', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(null);

      await expect(repository.findById('missing')).rejects.toThrow('Session');
    });
  });

  describe('findAll', () => {
    it('should return paginated sessions', async () => {
      mockPrisma.session.findMany.mockResolvedValue([mockSession]);
      mockPrisma.session.count.mockResolvedValue(1);

      const result = await repository.findAll({ page: 1, limit: 10 });

      expect(result.data).toEqual([mockSession]);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });
  });

  describe('findActive', () => {
    it('should return only active sessions', async () => {
      mockPrisma.session.findMany.mockResolvedValue([mockSession]);
      mockPrisma.session.count.mockResolvedValue(1);

      const result = await repository.findActive({ page: 1, limit: 10 });

      expect(result.data).toEqual([mockSession]);
      expect(mockPrisma.session.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'desc' },
      });
      expect(mockPrisma.session.count).toHaveBeenCalledWith({
        where: { isActive: true },
      });
    });
  });

  describe('findByUserId', () => {
    it('should return paginated sessions for a user', async () => {
      const sessionWithMessages = {
        ...mockSession,
        topic: null,
        sessionMessages: [{ content: 'Hello world' }],
      };
      mockPrisma.session.findMany.mockResolvedValue([sessionWithMessages]);
      mockPrisma.session.count.mockResolvedValue(1);

      const result = await repository.findByUserId('user-1', {
        page: 1,
        limit: 10,
      });

      // Topic should be derived from first user message
      expect(result.data[0]?.topic).toBe('Hello world');
      expect(mockPrisma.session.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isActive: true },
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          sessionMessages: {
            where: { role: 'user' },
            orderBy: { ordering: 'asc' },
            take: 1,
            select: { content: true },
          },
        },
      });
    });

    it('should use stored topic over derived topic', async () => {
      const sessionWithTopic = {
        ...mockSession,
        topic: 'Custom Topic',
        sessionMessages: [{ content: 'Hello world' }],
      };
      mockPrisma.session.findMany.mockResolvedValue([sessionWithTopic]);
      mockPrisma.session.count.mockResolvedValue(1);

      const result = await repository.findByUserId('user-1', { page: 1, limit: 10 });

      expect(result.data[0]?.topic).toBe('Custom Topic');
    });

    it('should return null topic when no messages', async () => {
      const sessionNoMessages = {
        ...mockSession,
        topic: null,
        sessionMessages: [],
      };
      mockPrisma.session.findMany.mockResolvedValue([sessionNoMessages]);
      mockPrisma.session.count.mockResolvedValue(1);

      const result = await repository.findByUserId('user-1', { page: 1, limit: 10 });

      expect(result.data[0]?.topic).toBeNull();
    });
  });

  describe('findActiveByUserId', () => {
    it('should return active sessions for a user', async () => {
      mockPrisma.session.findMany.mockResolvedValue([mockSession]);

      const result = await repository.findActiveByUserId('user-1');

      expect(result).toEqual([mockSession]);
      expect(mockPrisma.session.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isActive: true },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array when no active sessions', async () => {
      mockPrisma.session.findMany.mockResolvedValue([]);

      const result = await repository.findActiveByUserId('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('create', () => {
    it('should create a session with required fields', async () => {
      mockPrisma.session.create.mockResolvedValue(mockSession);

      const result = await repository.create({
        userId: 'user-1',
        agentDefinitionId: 'agent-1',
      });

      expect(result).toEqual(mockSession);
      expect(mockPrisma.session.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          agentDefinitionId: 'agent-1',
        },
      });
    });

    it('should create a session with channelId', async () => {
      mockPrisma.session.create.mockResolvedValue(mockSession);

      await repository.create({
        userId: 'user-1',
        agentDefinitionId: 'agent-1',
        channelId: 'ch-1',
      });

      expect(mockPrisma.session.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          agentDefinitionId: 'agent-1',
          channelId: 'ch-1',
        },
      });
    });

    it('should create a session with null channelId', async () => {
      mockPrisma.session.create.mockResolvedValue({
        ...mockSession,
        channelId: null,
      });

      await repository.create({
        userId: 'user-1',
        agentDefinitionId: 'agent-1',
        channelId: null,
      });

      expect(mockPrisma.session.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          agentDefinitionId: 'agent-1',
          channelId: null,
        },
      });
    });

    it('should call handlePrismaError on failure', async () => {
      mockPrisma.session.create.mockRejectedValue({ code: 'P2002', meta: { target: ['id'] } });

      await expect(
        repository.create({ userId: 'user-1', agentDefinitionId: 'agent-1' }),
      ).rejects.toThrow();
    });
  });

  describe('update', () => {
    it('should update a session', async () => {
      const updated = { ...mockSession, isActive: false };
      mockPrisma.session.update.mockResolvedValue(updated);

      const result = await repository.update('sess-1', { isActive: false });

      expect(result).toEqual(updated);
      expect(mockPrisma.session.update).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
        data: { isActive: false },
      });
    });

    it('should update lastConsolidatedAt', async () => {
      const now = new Date();
      const updated = { ...mockSession, lastConsolidatedAt: now };
      mockPrisma.session.update.mockResolvedValue(updated);

      const result = await repository.update('sess-1', {
        lastConsolidatedAt: now,
      });

      expect(result.lastConsolidatedAt).toEqual(now);
    });

    it('should call handlePrismaError on failure', async () => {
      mockPrisma.session.update.mockRejectedValue({ code: 'P2025' });

      await expect(repository.update('missing', { isActive: false })).rejects.toThrow();
    });
  });

  describe('deactivate', () => {
    it('should set isActive to false', async () => {
      const deactivated = { ...mockSession, isActive: false };
      mockPrisma.session.update.mockResolvedValue(deactivated);

      const result = await repository.deactivate('sess-1');

      expect(result.isActive).toBe(false);
      expect(mockPrisma.session.update).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
        data: { isActive: false },
      });
    });

    it('should call handlePrismaError on failure', async () => {
      mockPrisma.session.update.mockRejectedValue({ code: 'P2025' });

      await expect(repository.deactivate('missing')).rejects.toThrow();
    });
  });

  describe('delete', () => {
    it('should delete a session', async () => {
      mockPrisma.session.delete.mockResolvedValue(mockSession);

      const result = await repository.delete('sess-1');

      expect(result).toEqual(mockSession);
      expect(mockPrisma.session.delete).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
      });
    });

    it('should call handlePrismaError on failure', async () => {
      mockPrisma.session.delete.mockRejectedValue({ code: 'P2025' });

      await expect(repository.delete('missing')).rejects.toThrow();
    });
  });

  describe('setCachedSystemPrompt', () => {
    it('persists the prompt when cachedSystemPrompt is null', async () => {
      mockPrisma.session.updateMany.mockResolvedValue({ count: 1 });

      await repository.setCachedSystemPrompt('sess-1', 'system prompt v1');

      expect(mockPrisma.session.updateMany).toHaveBeenCalledWith({
        where: { id: 'sess-1', cachedSystemPrompt: null },
        data: { cachedSystemPrompt: 'system prompt v1' },
      });
    });

    it('is a no-op when cachedSystemPrompt is already set (concurrent-race idempotency)', async () => {
      mockPrisma.session.updateMany.mockResolvedValue({ count: 0 });

      await repository.setCachedSystemPrompt('sess-1', 'system prompt v2');

      expect(mockPrisma.session.updateMany).toHaveBeenCalledWith({
        where: { id: 'sess-1', cachedSystemPrompt: null },
        data: { cachedSystemPrompt: 'system prompt v2' },
      });
    });
  });
});
