import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ChatController } from '../chat.controller.js';

describe('ChatController', () => {
  const mockSessionRepo = {
    findByUserId: vi.fn(),
    findById: vi.fn(),
    delete: vi.fn(),
  };
  const mockPrisma = {
    sessionMessage: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createController(): ChatController {
    const mockRegistry = { abortAllForUser: vi.fn() };
    return new ChatController(mockSessionRepo as never, mockPrisma as never, mockRegistry as never);
  }

  describe('GET /api/v1/chat/sessions', () => {
    it('returns paginated sessions for the authenticated user', async () => {
      const sessions = [{ id: 'sess-1', userId: 'user-1', isActive: true, createdAt: new Date() }];
      mockSessionRepo.findByUserId.mockResolvedValue({
        data: sessions,
        meta: { total: 1, page: 1, limit: 20 },
      });

      const controller = createController();
      const req = { user: { sub: 'user-1' } };
      const result = await controller.listSessions(req as never, { page: 1, limit: 20 });

      expect(result).toEqual({
        success: true,
        data: sessions,
        meta: { total: 1, page: 1, limit: 20 },
      });
      expect(mockSessionRepo.findByUserId).toHaveBeenCalledWith(
        'user-1',
        { page: 1, limit: 20 },
        undefined,
        false,
      );
    });

    it('defaults to page 1, limit 20', async () => {
      mockSessionRepo.findByUserId.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 20 },
      });

      const controller = createController();
      const req = { user: { sub: 'user-1' } };
      await controller.listSessions(req as never, {});

      expect(mockSessionRepo.findByUserId).toHaveBeenCalledWith(
        'user-1',
        { page: 1, limit: 20 },
        undefined,
        false,
      );
    });

    it('caps limit at 100', async () => {
      mockSessionRepo.findByUserId.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 20 },
      });

      const controller = createController();
      const req = { user: { sub: 'user-1' } };
      await controller.listSessions(req as never, { limit: 500 });

      expect(mockSessionRepo.findByUserId).toHaveBeenCalledWith(
        'user-1',
        { page: 1, limit: 100 },
        undefined,
        false,
      );
    });
  });

  describe('POST /api/v1/chat/agent-runs/stop', () => {
    it('calls registry.abortAllForUser and returns the stopped count', async () => {
      const mockRegistry = {
        abortAllForUser: vi.fn().mockResolvedValue({ stopped: 3 }),
      };
      const controller = new ChatController(
        mockSessionRepo as never,
        mockPrisma as never,
        mockRegistry as never,
      );

      const result = await controller.stopRunningAgentRuns({
        user: { sub: 'user-42' } as never,
      });

      expect(mockRegistry.abortAllForUser).toHaveBeenCalledWith('user-42');
      expect(result).toEqual({ success: true, stopped: 3 });
    });
  });

  describe('GET /api/v1/chat/sessions/:id/messages', () => {
    it('returns paginated messages for a session owned by user', async () => {
      const messages = [
        {
          id: 'msg-1',
          sessionId: 'sess-1',
          role: 'user',
          content: 'Hello',
          senderId: 'user-1',
          createdAt: new Date(),
        },
        {
          id: 'msg-2',
          sessionId: 'sess-1',
          role: 'assistant',
          content: 'Hi there',
          senderId: null,
          createdAt: new Date(),
        },
      ];
      mockSessionRepo.findById.mockResolvedValue({ id: 'sess-1', userId: 'user-1' });
      mockPrisma.sessionMessage.findMany.mockResolvedValue(messages);
      mockPrisma.sessionMessage.count.mockResolvedValue(2);

      const controller = createController();
      const req = { user: { sub: 'user-1' } };
      const result = await controller.listMessages(req as never, 'sess-1', { page: 1, limit: 50 });

      expect(result).toEqual({
        success: true,
        data: messages,
        meta: { total: 2, page: 1, limit: 50 },
      });
      expect(mockPrisma.sessionMessage.findMany).toHaveBeenCalledWith({
        where: { sessionId: 'sess-1', archivedAt: null, hiddenInHistory: false },
        orderBy: { ordering: 'desc' },
        skip: 0,
        take: 50,
      });
    });

    it('excludes hiddenInHistory rows from both the page query and the total count', async () => {
      mockSessionRepo.findById.mockResolvedValue({ id: 'sess-1', userId: 'user-1' });
      mockPrisma.sessionMessage.findMany.mockResolvedValue([]);
      mockPrisma.sessionMessage.count.mockResolvedValue(0);

      const controller = createController();
      const req = { user: { sub: 'user-1' } };
      await controller.listMessages(req as never, 'sess-1', { page: 1, limit: 50 });

      const expectedWhere = { sessionId: 'sess-1', archivedAt: null, hiddenInHistory: false };
      expect(mockPrisma.sessionMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      // Count must apply the same filter or pagination math drifts.
      expect(mockPrisma.sessionMessage.count).toHaveBeenCalledWith({ where: expectedWhere });
    });

    it('throws NotFoundException when session belongs to another user', async () => {
      mockSessionRepo.findById.mockResolvedValue({ id: 'sess-1', userId: 'other-user' });

      const controller = createController();
      const req = { user: { sub: 'user-1' } };

      await expect(controller.listMessages(req as never, 'sess-1', {})).rejects.toThrow(
        'Session not found',
      );
    });

    it('defaults to page 1, limit 50', async () => {
      mockSessionRepo.findById.mockResolvedValue({ id: 'sess-1', userId: 'user-1' });
      mockPrisma.sessionMessage.findMany.mockResolvedValue([]);
      mockPrisma.sessionMessage.count.mockResolvedValue(0);

      const controller = createController();
      const req = { user: { sub: 'user-1' } };
      await controller.listMessages(req as never, 'sess-1', {});

      expect(mockPrisma.sessionMessage.findMany).toHaveBeenCalledWith({
        where: { sessionId: 'sess-1', archivedAt: null, hiddenInHistory: false },
        orderBy: { ordering: 'desc' },
        skip: 0,
        take: 50,
      });
    });
  });

  describe('DELETE /api/v1/chat/sessions/:id', () => {
    it('deletes a session owned by the caller', async () => {
      mockSessionRepo.findById.mockResolvedValue({ id: 'sess-1', userId: 'user-1' });
      mockSessionRepo.delete.mockResolvedValue({ id: 'sess-1' });

      const controller = createController();
      const req = { user: { sub: 'user-1' } };
      const result = await controller.deleteSession(req as never, 'sess-1');

      expect(result).toEqual({ success: true });
      expect(mockSessionRepo.delete).toHaveBeenCalledWith('sess-1');
    });

    it('throws NotFoundException when session belongs to another user', async () => {
      mockSessionRepo.findById.mockResolvedValue({ id: 'sess-1', userId: 'other-user' });

      const controller = createController();
      const req = { user: { sub: 'user-1' } };

      await expect(controller.deleteSession(req as never, 'sess-1')).rejects.toThrow(
        'Session not found',
      );
      expect(mockSessionRepo.delete).not.toHaveBeenCalled();
    });
  });
});
