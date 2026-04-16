import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundError } from '@clawix/shared';

vi.mock('@clawix/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clawix/shared')>();
  return {
    ...actual,
    createLogger: vi.fn().mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

import { SessionManagerService } from '../session-manager.service.js';
import type { SessionRepository } from '../../db/session.repository.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

/* ------------------------------------------------------------------ */
/*  Mock helpers                                                       */
/* ------------------------------------------------------------------ */

function makeSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'session-1',
    userId: 'user-1',
    agentDefinitionId: 'agent-def-1',
    channelId: null,
    lastConsolidatedAt: null,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeSessionMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'user',
    content: 'Hello',
    toolCallId: null,
    toolCalls: null,
    ordering: 0,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Test setup                                                         */
/* ------------------------------------------------------------------ */

describe('SessionManagerService', () => {
  let service: SessionManagerService;
  let mockSessionRepo: {
    findById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let mockSessionMessage: {
    findMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  let mockPrisma: {
    sessionMessage: typeof mockSessionMessage;
    $transaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSessionRepo = {
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };

    mockSessionMessage = {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    };

    mockPrisma = { sessionMessage: mockSessionMessage, $transaction: vi.fn() };

    service = new SessionManagerService(
      mockSessionRepo as unknown as SessionRepository,
      mockPrisma as unknown as PrismaService,
    );
  });

  /* ---------------------------------------------------------------- */
  /*  getOrCreate                                                      */
  /* ---------------------------------------------------------------- */

  describe('getOrCreate', () => {
    it('creates a new session when no sessionId is provided', async () => {
      const newSession = makeSession();
      mockSessionRepo.create.mockResolvedValue(newSession);

      const result = await service.getOrCreate({
        userId: 'user-1',
        agentDefinitionId: 'agent-def-1',
      });

      expect(mockSessionRepo.create).toHaveBeenCalledOnce();
      expect(mockSessionRepo.create).toHaveBeenCalledWith({
        userId: 'user-1',
        agentDefinitionId: 'agent-def-1',
      });
      expect(result).toEqual(newSession);
    });

    it('resumes existing session when valid sessionId is provided', async () => {
      const existingSession = makeSession();
      mockSessionRepo.findById.mockResolvedValue(existingSession);

      const result = await service.getOrCreate({
        userId: 'user-1',
        agentDefinitionId: 'agent-def-1',
        sessionId: 'session-1',
      });

      expect(mockSessionRepo.findById).toHaveBeenCalledWith('session-1');
      expect(mockSessionRepo.create).not.toHaveBeenCalled();
      expect(result).toEqual(existingSession);
    });

    it('throws NotFoundError when sessionId does not exist', async () => {
      mockSessionRepo.findById.mockRejectedValue(new NotFoundError('Session', 'session-999'));

      await expect(
        service.getOrCreate({
          userId: 'user-1',
          agentDefinitionId: 'agent-def-1',
          sessionId: 'session-999',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws when session belongs to a different user', async () => {
      const session = makeSession({ userId: 'other-user' });
      mockSessionRepo.findById.mockResolvedValue(session);

      await expect(
        service.getOrCreate({
          userId: 'user-1',
          agentDefinitionId: 'agent-def-1',
          sessionId: 'session-1',
        }),
      ).rejects.toThrow();
    });

    it('throws when session belongs to a different agent definition', async () => {
      const session = makeSession({ agentDefinitionId: 'other-agent' });
      mockSessionRepo.findById.mockResolvedValue(session);

      await expect(
        service.getOrCreate({
          userId: 'user-1',
          agentDefinitionId: 'agent-def-1',
          sessionId: 'session-1',
        }),
      ).rejects.toThrow();
    });

    it('throws when session is inactive', async () => {
      const session = makeSession({ isActive: false });
      mockSessionRepo.findById.mockResolvedValue(session);

      await expect(
        service.getOrCreate({
          userId: 'user-1',
          agentDefinitionId: 'agent-def-1',
          sessionId: 'session-1',
        }),
      ).rejects.toThrow();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  loadMessages                                                     */
  /* ---------------------------------------------------------------- */

  describe('loadMessages', () => {
    it('returns ChatMessages ordered by ordering', async () => {
      const rows = [
        makeSessionMessage({
          id: 'msg-0',
          role: 'system',
          content: 'You are helpful.',
          ordering: 0,
        }),
        makeSessionMessage({ id: 'msg-1', role: 'user', content: 'Hello', ordering: 1 }),
        makeSessionMessage({ id: 'msg-2', role: 'assistant', content: 'Hi there!', ordering: 2 }),
      ];
      mockSessionMessage.findMany.mockResolvedValue(rows);

      const result = await service.loadMessages('session-1');

      expect(mockSessionMessage.findMany).toHaveBeenCalledWith({
        where: { sessionId: 'session-1', archivedAt: null },
        orderBy: { ordering: 'asc' },
      });
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ role: 'system', content: 'You are helpful.' });
      expect(result[1]).toEqual({ role: 'user', content: 'Hello' });
      expect(result[2]).toEqual({ role: 'assistant', content: 'Hi there!' });
    });

    it('includes toolCallId in ChatMessage when present', async () => {
      const rows = [
        makeSessionMessage({
          role: 'tool',
          content: '{"result": "ok"}',
          toolCallId: 'call-123',
          ordering: 0,
        }),
      ];
      mockSessionMessage.findMany.mockResolvedValue(rows);

      const result = await service.loadMessages('session-1');

      expect(result[0]).toMatchObject({ role: 'tool', toolCallId: 'call-123' });
    });

    it('includes toolCalls in ChatMessage when present', async () => {
      const toolCalls = [{ id: 'call-1', name: 'search', arguments: { q: 'test' } }];
      const rows = [
        makeSessionMessage({
          role: 'assistant',
          content: '',
          toolCalls,
          ordering: 0,
        }),
      ];
      mockSessionMessage.findMany.mockResolvedValue(rows);

      const result = await service.loadMessages('session-1');

      expect(result[0]).toMatchObject({ role: 'assistant', toolCalls });
    });

    it('omits toolCallId and toolCalls when null', async () => {
      const rows = [
        makeSessionMessage({
          role: 'user',
          content: 'Hi',
          toolCallId: null,
          toolCalls: null,
          ordering: 0,
        }),
      ];
      mockSessionMessage.findMany.mockResolvedValue(rows);

      const result = await service.loadMessages('session-1');

      expect(result[0]).not.toHaveProperty('toolCallId');
      expect(result[0]).not.toHaveProperty('toolCalls');
    });

    it('returns empty array when no messages exist', async () => {
      mockSessionMessage.findMany.mockResolvedValue([]);

      const result = await service.loadMessages('session-1');

      expect(result).toEqual([]);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  saveMessages                                                     */
  /* ---------------------------------------------------------------- */

  describe('saveMessages', () => {
    it('saves messages with ordering offset from current count', async () => {
      mockSessionMessage.count.mockResolvedValue(2);
      const mockCreate = vi
        .fn()
        .mockResolvedValueOnce({ id: 'id-1' })
        .mockResolvedValueOnce({ id: 'id-2' });
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const fakeTx = { sessionMessage: { create: mockCreate } };
        return fn(fakeTx);
      });

      const ids = await service.saveMessages('session-1', [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi!' },
      ]);

      expect(ids).toEqual(['id-1', 'id-2']);
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(mockCreate).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({
          sessionId: 'session-1',
          role: 'user',
          content: 'Hello',
          ordering: 2,
        }),
      });
      expect(mockCreate).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Hi!',
          ordering: 3,
        }),
      });
    });

    it('saves starting at ordering 0 when no existing messages', async () => {
      mockSessionMessage.count.mockResolvedValue(0);
      const mockCreate = vi.fn().mockResolvedValueOnce({ id: 'id-1' });
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const fakeTx = { sessionMessage: { create: mockCreate } };
        return fn(fakeTx);
      });

      await service.saveMessages('session-1', [
        { role: 'system' as const, content: 'System prompt' },
      ]);

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ ordering: 0 }),
      });
    });

    it('persists toolCallId and toolCalls when provided', async () => {
      mockSessionMessage.count.mockResolvedValue(0);
      const toolCalls = [{ id: 'call-1', name: 'search', arguments: { q: 'test' } }];
      const mockCreate = vi.fn().mockResolvedValueOnce({ id: 'id-1' });
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const fakeTx = { sessionMessage: { create: mockCreate } };
        return fn(fakeTx);
      });

      await service.saveMessages('session-1', [
        { role: 'assistant' as const, content: '', toolCalls: toolCalls as never },
      ]);

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ toolCalls }),
      });
    });

    it('persists senderId when provided in ChatMessage', async () => {
      mockPrisma.sessionMessage.count.mockResolvedValue(0);
      const mockCreate = vi.fn().mockResolvedValueOnce({ id: 'id-1' });
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const fakeTx = { sessionMessage: { create: mockCreate } };
        return fn(fakeTx);
      });

      await service.saveMessages('session-1', [
        { role: 'user', content: 'Hello', senderId: 'user-1' },
      ]);

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sessionId: 'session-1',
          role: 'user',
          content: 'Hello',
          senderId: 'user-1',
          ordering: 0,
        }),
      });
    });

    it('sets senderId to undefined when not provided', async () => {
      mockPrisma.sessionMessage.count.mockResolvedValue(0);
      const mockCreate = vi.fn().mockResolvedValueOnce({ id: 'id-1' });
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const fakeTx = { sessionMessage: { create: mockCreate } };
        return fn(fakeTx);
      });

      await service.saveMessages('session-1', [{ role: 'assistant', content: 'Hi there' }]);

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sessionId: 'session-1',
          senderId: undefined,
        }),
      });
    });

    it('returns created message IDs in insertion order', async () => {
      mockSessionMessage.count.mockResolvedValue(0);
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const fakeTx = {
          sessionMessage: {
            create: vi
              .fn()
              .mockResolvedValueOnce({ id: 'msg-id-1' })
              .mockResolvedValueOnce({ id: 'msg-id-2' }),
          },
        };
        return fn(fakeTx);
      });

      const ids = await service.saveMessages('session-1', [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi!' },
      ]);

      expect(ids).toEqual(['msg-id-1', 'msg-id-2']);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  compact                                                          */
  /* ---------------------------------------------------------------- */

  describe('compact', () => {
    it('is a no-op when messages are under the threshold', async () => {
      const rows = Array.from({ length: 30 }, (_, i) =>
        makeSessionMessage({ id: `msg-${i}`, role: 'user', content: `msg ${i}`, ordering: i }),
      );
      mockSessionMessage.findMany.mockResolvedValue(rows);

      await service.compact('session-1', 50);

      expect(mockSessionMessage.deleteMany).not.toHaveBeenCalled();
      expect(mockSessionMessage.updateMany).not.toHaveBeenCalled();
    });

    it('keeps system message + last N non-system messages and archives the rest', async () => {
      const systemMsg = makeSessionMessage({
        id: 'sys-0',
        role: 'system',
        content: 'Be helpful.',
        ordering: 0,
      });
      const nonSystemMsgs = Array.from({ length: 60 }, (_, i) =>
        makeSessionMessage({
          id: `msg-${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `msg ${i}`,
          ordering: i + 1,
        }),
      );
      const allRows = [systemMsg, ...nonSystemMsgs];
      mockSessionMessage.findMany.mockResolvedValue(allRows);
      mockSessionMessage.updateMany.mockResolvedValue({ count: 10 });

      await service.compact('session-1', 50);

      // Should archive 61 total - 1 system - 50 kept = 10 archived
      expect(mockSessionMessage.deleteMany).not.toHaveBeenCalled();
      expect(mockSessionMessage.updateMany).toHaveBeenCalledOnce();
      const callArg = mockSessionMessage.updateMany.mock.calls[0]?.[0] as {
        where: { id: { in: string[] } };
        data: { archivedAt: Date };
      };
      // The IDs archived should be the oldest non-system messages (10 of them)
      expect(callArg.where.id.in).toHaveLength(10);
      // msg-0 through msg-9 should be archived (oldest non-system)
      expect(callArg.where.id.in).toContain('msg-0');
      expect(callArg.where.id.in).not.toContain('sys-0');
      expect(callArg.where.id.in).not.toContain('msg-59');
      expect(callArg.data.archivedAt).toEqual(expect.any(Date));
    });

    it('keeps system message even when all non-system messages are trimmed', async () => {
      const systemMsg = makeSessionMessage({
        id: 'sys-0',
        role: 'system',
        content: 'Be helpful.',
        ordering: 0,
      });
      const nonSystemMsgs = Array.from({ length: 60 }, (_, i) =>
        makeSessionMessage({ id: `msg-${i}`, role: 'user', content: `msg ${i}`, ordering: i + 1 }),
      );
      const allRows = [systemMsg, ...nonSystemMsgs];
      mockSessionMessage.findMany.mockResolvedValue(allRows);
      mockSessionMessage.updateMany.mockResolvedValue({ count: 10 });

      await service.compact('session-1', 50);

      expect(mockSessionMessage.deleteMany).not.toHaveBeenCalled();
      expect(mockSessionMessage.updateMany).toHaveBeenCalledOnce();
      const callArg = mockSessionMessage.updateMany.mock.calls[0]?.[0] as {
        where: { id: { in: string[] } };
        data: { archivedAt: Date };
      };
      expect(callArg.where.id.in).not.toContain('sys-0');
      expect(callArg.data.archivedAt).toEqual(expect.any(Date));
    });

    it('is a no-op when there are no messages', async () => {
      mockSessionMessage.findMany.mockResolvedValue([]);

      await service.compact('session-1', 50);

      expect(mockSessionMessage.deleteMany).not.toHaveBeenCalled();
      expect(mockSessionMessage.updateMany).not.toHaveBeenCalled();
    });

    it('uses default maxMessages of 50 when not provided', async () => {
      const rows = Array.from({ length: 30 }, (_, i) =>
        makeSessionMessage({ id: `msg-${i}`, role: 'user', content: `msg ${i}`, ordering: i }),
      );
      mockSessionMessage.findMany.mockResolvedValue(rows);

      // Should not throw and should be no-op for 30 messages (under default 50)
      await service.compact('session-1');

      expect(mockSessionMessage.deleteMany).not.toHaveBeenCalled();
      expect(mockSessionMessage.updateMany).not.toHaveBeenCalled();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  deactivate                                                       */
  /* ---------------------------------------------------------------- */

  describe('deactivate', () => {
    it('sets session isActive to false', async () => {
      const updatedSession = makeSession({ isActive: false });
      mockSessionRepo.update.mockResolvedValue(updatedSession);

      await service.deactivate('session-1');

      expect(mockSessionRepo.update).toHaveBeenCalledWith('session-1', { isActive: false });
    });

    it('returns the updated session', async () => {
      const updatedSession = makeSession({ isActive: false });
      mockSessionRepo.update.mockResolvedValue(updatedSession);

      const result = await service.deactivate('session-1');

      expect(result).toEqual(updatedSession);
    });
  });
});
