import { describe, expect, it, vi, beforeEach } from 'vitest';

import { MessageRouterService } from '../message-router.service.js';
import type { ChannelAdapter, InboundMessage } from '@clawix/shared';

function mockChannel(): ChannelAdapter {
  return {
    id: 'channel-1',
    type: 'telegram',
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendTyping: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn(),
  };
}

function mockInbound(overrides?: Partial<InboundMessage>): InboundMessage {
  return {
    channelType: 'telegram',
    channelMessageId: 'msg-1',
    senderId: '123456',
    senderName: 'Test User',
    text: 'Hello agent',
    timestamp: new Date(),
    ...overrides,
  };
}

describe('MessageRouterService', () => {
  const mockUserRepo = {
    findByTelegramId: vi.fn(),
    findById: vi.fn(),
  };
  const mockUserAgentRepo = {
    findByUserId: vi.fn(),
  };
  const mockAgentRunner = {
    run: vi.fn(),
  };
  const mockSessionManager = {
    getOrCreate: vi.fn(),
  };
  const mockPrisma = {
    agentRun: {
      count: vi.fn().mockResolvedValue(0),
    },
  };
  const mockCommandService = {
    isSlashPrefixed: vi.fn().mockReturnValue(false),
    execute: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.agentRun.count.mockResolvedValue(0);
    mockCommandService.isSlashPrefixed.mockReturnValue(false);
  });

  function createRouter() {
    return new MessageRouterService(
      mockUserRepo as never,
      mockUserAgentRepo as never,
      mockAgentRunner as never,
      mockSessionManager as never,
      mockPrisma as never,
      mockCommandService as never,
    );
  }

  it('routes message to agent when user is authorized', async () => {
    const user = { id: 'user-1', telegramId: '123456', isActive: true };
    const userAgent = { agentDefinitionId: 'agent-1' };
    const session = { id: 'session-1' };
    const runResult = {
      output: 'Hello human',
      status: 'completed',
      responseMessageId: 'msg-abc',
      tokenUsage: { input: 10, output: 5 },
    };

    mockUserRepo.findByTelegramId.mockResolvedValue(user);
    mockUserAgentRepo.findByUserId.mockResolvedValue(userAgent);
    mockSessionManager.getOrCreate.mockResolvedValue(session);
    mockAgentRunner.run.mockResolvedValue(runResult);

    const channel = mockChannel();
    const router = createRouter();

    await router.handleInbound(mockInbound(), channel);

    expect(mockAgentRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDefinitionId: 'agent-1',
        sessionId: 'session-1',
        userId: 'user-1',
        input: 'Hello agent',
      }),
    );
    expect(channel.sendMessage).toHaveBeenCalledWith({
      recipientId: '123456',
      text: 'Hello human',
      metadata: {
        messageId: 'msg-abc',
        sessionId: 'session-1',
      },
    });
  });

  it('falls back to agentRunId when responseMessageId is missing', async () => {
    const user = { id: 'user-1', telegramId: '123456', isActive: true };
    const userAgent = { agentDefinitionId: 'agent-1' };
    const session = { id: 'session-1' };
    const runResult = {
      agentRunId: 'run-xyz',
      output: 'Response',
      status: 'completed',
      tokenUsage: { input: 10, output: 5 },
    };

    mockUserRepo.findByTelegramId.mockResolvedValue(user);
    mockUserAgentRepo.findByUserId.mockResolvedValue(userAgent);
    mockSessionManager.getOrCreate.mockResolvedValue(session);
    mockAgentRunner.run.mockResolvedValue(runResult);

    const channel = mockChannel();
    const router = createRouter();

    await router.handleInbound(mockInbound(), channel);

    expect(channel.sendMessage).toHaveBeenCalledWith({
      recipientId: '123456',
      text: 'Response',
      metadata: {
        messageId: 'run-xyz',
        sessionId: 'session-1',
      },
    });
  });

  it('sends unauthorized message when user not found', async () => {
    mockUserRepo.findByTelegramId.mockResolvedValue(null);

    const channel = mockChannel();
    const router = createRouter();

    await router.handleInbound(mockInbound(), channel);

    expect(channel.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('not authorized'),
      }),
    );
    expect(mockAgentRunner.run).not.toHaveBeenCalled();
  });

  it('sends unauthorized message when user is inactive', async () => {
    mockUserRepo.findByTelegramId.mockResolvedValue({
      id: 'user-1',
      isActive: false,
    });

    const channel = mockChannel();
    const router = createRouter();

    await router.handleInbound(mockInbound(), channel);

    expect(channel.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('not authorized'),
      }),
    );
  });

  it('sends no-agent message when user has no UserAgent', async () => {
    mockUserRepo.findByTelegramId.mockResolvedValue({
      id: 'user-1',
      isActive: true,
    });
    mockUserAgentRepo.findByUserId.mockResolvedValue(null);

    const channel = mockChannel();
    const router = createRouter();

    await router.handleInbound(mockInbound(), channel);

    expect(channel.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('No agent'),
      }),
    );
  });

  it('sends busy message when user has a running agent', async () => {
    mockUserRepo.findByTelegramId.mockResolvedValue({
      id: 'user-1',
      isActive: true,
    });
    mockUserAgentRepo.findByUserId.mockResolvedValue({
      agentDefinitionId: 'agent-1',
    });
    mockPrisma.agentRun.count.mockResolvedValue(1);

    const channel = mockChannel();
    const router = createRouter();

    await router.handleInbound(mockInbound(), channel);

    expect(channel.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('still working'),
      }),
    );
    expect(mockAgentRunner.run).not.toHaveBeenCalled();
  });

  it('sends error message when agent execution fails', async () => {
    mockUserRepo.findByTelegramId.mockResolvedValue({
      id: 'user-1',
      isActive: true,
    });
    mockUserAgentRepo.findByUserId.mockResolvedValue({
      agentDefinitionId: 'agent-1',
    });
    mockSessionManager.getOrCreate.mockResolvedValue({ id: 'session-1' });
    mockAgentRunner.run.mockRejectedValue(new Error('LLM timeout'));

    const channel = mockChannel();
    const router = createRouter();

    await router.handleInbound(mockInbound(), channel);

    expect(channel.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('went wrong'),
      }),
    );
  });

  it('should pass channel, chatId, and userName to agentRunner.run', async () => {
    const user = { id: 'user-1', telegramId: '123456', isActive: true };
    const userAgent = { agentDefinitionId: 'agent-1' };
    const session = { id: 'session-1' };
    const runResult = {
      output: 'Hello human',
      status: 'completed',
      tokenUsage: { input: 10, output: 5 },
    };

    mockUserRepo.findByTelegramId.mockResolvedValue(user);
    mockUserAgentRepo.findByUserId.mockResolvedValue(userAgent);
    mockSessionManager.getOrCreate.mockResolvedValue(session);
    mockAgentRunner.run.mockResolvedValue(runResult);

    const channel = mockChannel();
    const router = createRouter();
    const inbound = mockInbound();

    await router.handleInbound(inbound, channel);

    expect(mockAgentRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: channel.type,
        chatId: inbound.senderId,
        userName: inbound.senderName,
      }),
    );
  });

  it('does not persist audit messages (Message table removed)', async () => {
    const user = { id: 'user-1', telegramId: '123456', isActive: true };
    mockUserRepo.findByTelegramId.mockResolvedValue(user);
    mockUserAgentRepo.findByUserId.mockResolvedValue({ agentDefinitionId: 'agent-1' });
    mockSessionManager.getOrCreate.mockResolvedValue({ id: 'session-1' });
    mockAgentRunner.run.mockResolvedValue({
      output: 'Response',
      status: 'completed',
      tokenUsage: { input: 0, output: 0 },
    });

    const channel = mockChannel();
    const router = createRouter();
    await router.handleInbound(mockInbound(), channel);

    expect(mockAgentRunner.run).toHaveBeenCalled();
    expect(channel.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'Response' }));
  });

  it('routes web channel message using findById lookup', async () => {
    const user = { id: 'user-1', isActive: true };
    const userAgent = { agentDefinitionId: 'agent-1' };
    const session = { id: 'session-1' };
    const runResult = {
      output: 'Hello from agent',
      status: 'completed',
      tokenUsage: { input: 10, output: 5 },
    };

    mockUserRepo.findById.mockResolvedValue(user);
    mockUserAgentRepo.findByUserId.mockResolvedValue(userAgent);
    mockSessionManager.getOrCreate.mockResolvedValue(session);
    mockAgentRunner.run.mockResolvedValue(runResult);

    const router = createRouter();
    const channel = { ...mockChannel(), type: 'web' as const };
    const message = mockInbound({ channelType: 'web', senderId: 'user-1' });

    await router.handleInbound(message, channel);

    expect(mockUserRepo.findById).toHaveBeenCalledWith('user-1');
    expect(mockUserRepo.findByTelegramId).not.toHaveBeenCalled();
    expect(mockAgentRunner.run).toHaveBeenCalled();
  });

  it('uses findByTelegramId for telegram channel type', async () => {
    const user = { id: 'user-1', telegramId: '123456', isActive: true };
    const userAgent = { agentDefinitionId: 'agent-1' };
    const session = { id: 'session-1' };
    const runResult = {
      output: 'Hello',
      status: 'completed',
      tokenUsage: { input: 10, output: 5 },
    };

    mockUserRepo.findByTelegramId.mockResolvedValue(user);
    mockUserAgentRepo.findByUserId.mockResolvedValue(userAgent);
    mockSessionManager.getOrCreate.mockResolvedValue(session);
    mockAgentRunner.run.mockResolvedValue(runResult);

    const router = createRouter();
    await router.handleInbound(mockInbound(), mockChannel());

    expect(mockUserRepo.findByTelegramId).toHaveBeenCalledWith('123456');
    expect(mockUserRepo.findById).not.toHaveBeenCalled();
  });

  describe('session commands', () => {
    const user = { id: 'user-1', telegramId: '123456', isActive: true };
    const userAgent = { agentDefinitionId: 'agent-1' };
    const session = { id: 'session-1' };

    beforeEach(() => {
      mockUserRepo.findByTelegramId.mockResolvedValue(user);
      mockUserAgentRepo.findByUserId.mockResolvedValue(userAgent);
      mockSessionManager.getOrCreate.mockResolvedValue(session);
    });

    it('intercepts /reset and short-circuits before agent execution', async () => {
      mockCommandService.isSlashPrefixed.mockReturnValue(true);
      mockCommandService.execute.mockResolvedValue({ text: 'Session reset.' });

      const router = createRouter();
      const ch = mockChannel();
      await router.handleInbound(mockInbound({ text: '/reset' }), ch);

      expect(mockCommandService.execute).toHaveBeenCalledWith('/reset', {
        userId: 'user-1',
        sessionId: 'session-1',
        channelId: 'channel-1',
        senderId: '123456',
        agentDefinitionId: 'agent-1',
      });
      expect(ch.sendMessage).toHaveBeenCalledWith({
        recipientId: '123456',
        text: 'Session reset.',
      });
      expect(mockAgentRunner.run).not.toHaveBeenCalled();
    });

    it('executes command without audit message persistence', async () => {
      mockCommandService.isSlashPrefixed.mockReturnValue(true);
      mockCommandService.execute.mockResolvedValue({ text: 'Compacted.' });

      const router = createRouter();
      const ch = mockChannel();
      await router.handleInbound(mockInbound({ text: '/compact' }), ch);

      expect(mockCommandService.execute).toHaveBeenCalled();
      expect(ch.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'Compacted.' }));
    });

    it('skips concurrency check for commands', async () => {
      mockCommandService.isSlashPrefixed.mockReturnValue(true);
      mockCommandService.execute.mockResolvedValue({ text: 'Help text.' });
      mockPrisma.agentRun.count.mockResolvedValue(1); // agent is running

      const router = createRouter();
      const ch = mockChannel();
      await router.handleInbound(mockInbound({ text: '/help' }), ch);

      // Command still executes despite running agent
      expect(mockCommandService.execute).toHaveBeenCalled();
      expect(ch.sendMessage).toHaveBeenCalled();
    });

    it('does not intercept non-command messages', async () => {
      mockCommandService.isSlashPrefixed.mockReturnValue(false);
      mockAgentRunner.run.mockResolvedValue({
        output: 'response',
        status: 'completed',
        tokenUsage: { input: 10, output: 5 },
      });

      const router = createRouter();
      await router.handleInbound(mockInbound({ text: 'Hello' }), mockChannel());

      expect(mockCommandService.execute).not.toHaveBeenCalled();
      expect(mockAgentRunner.run).toHaveBeenCalled();
    });
  });
});
