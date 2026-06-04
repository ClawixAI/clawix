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
    findByWhatsappJid: vi.fn(),
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
  const mockAgentDefRepo = {
    findById: vi.fn(),
  };
  const mockChannelRepo = {
    findById: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.agentRun.count.mockResolvedValue(0);
    mockCommandService.isSlashPrefixed.mockReturnValue(false);
    // Default: non-streaming agent, no channel override
    mockAgentDefRepo.findById.mockResolvedValue({ id: 'agent-1', streamingEnabled: false });
    mockChannelRepo.findById.mockResolvedValue({ id: 'channel-1', toolProgressMode: null });
  });

  function createRouter() {
    return new MessageRouterService(
      mockUserRepo as never,
      mockUserAgentRepo as never,
      mockAgentRunner as never,
      mockSessionManager as never,
      mockPrisma as never,
      mockCommandService as never,
      mockAgentDefRepo as never,
      mockChannelRepo as never,
    );
  }

  it('routes message to agent without pre-creating a session', async () => {
    const user = { id: 'user-1', telegramId: '123456', isActive: true };
    const userAgent = { agentDefinitionId: 'agent-1' };
    const runResult = {
      streamingUsed: false,
      sessionId: 'session-1',
      output: 'Hello human',
      status: 'completed',
      responseMessageId: 'msg-abc',
      tokenUsage: { input: 10, output: 5 },
    };

    mockUserRepo.findByTelegramId.mockResolvedValue(user);
    mockUserAgentRepo.findByUserId.mockResolvedValue(userAgent);
    mockAgentRunner.run.mockResolvedValue(runResult);

    const channel = mockChannel();
    const router = createRouter();

    await router.handleInbound(mockInbound(), channel);

    // Session creation is delegated to agent-runner, so the router
    // must not pre-create one for the regular agent path.
    expect(mockSessionManager.getOrCreate).not.toHaveBeenCalled();

    expect(mockAgentRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDefinitionId: 'agent-1',
        channelId: 'channel-1',
        userId: 'user-1',
        input: 'Hello agent',
        replyContext: undefined,
      }),
    );
    expect(channel.sendMessage).toHaveBeenCalledWith({
      recipientId: '123456',
      text: 'Hello human',
      metadata: {
        messageId: 'msg-abc',
        replyToMessageId: 'msg-1',
        sessionId: 'session-1',
      },
    });
  });

  it('forwards reply context to agent runner', async () => {
    const user = { id: 'user-1', telegramId: '123456', isActive: true };
    const userAgent = { agentDefinitionId: 'agent-1' };
    const runResult = {
      streamingUsed: false,
      sessionId: 'session-1',
      output: 'Context received',
      status: 'completed',
      responseMessageId: 'msg-abc',
      tokenUsage: { input: 10, output: 5 },
    };

    mockUserRepo.findByTelegramId.mockResolvedValue(user);
    mockUserAgentRepo.findByUserId.mockResolvedValue(userAgent);
    mockAgentRunner.run.mockResolvedValue(runResult);

    const channel = mockChannel();
    const router = createRouter();

    await router.handleInbound(
      mockInbound({
        replyCtx: {
          from: { id: 42, date: 1_700_000_000, isBot: false },
          text: 'Original message',
        },
      }),
      channel,
    );

    expect(mockAgentRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        replyContext: {
          from: { id: 42, date: 1_700_000_000, isBot: false },
          text: 'Original message',
        },
      }),
    );
  });

  it('falls back to agentRunId when responseMessageId is missing', async () => {
    const user = { id: 'user-1', telegramId: '123456', isActive: true };
    const userAgent = { agentDefinitionId: 'agent-1' };
    const runResult = {
      streamingUsed: false,
      agentRunId: 'run-xyz',
      sessionId: 'session-1',
      output: 'Response',
      status: 'completed',
      tokenUsage: { input: 10, output: 5 },
    };

    mockUserRepo.findByTelegramId.mockResolvedValue(user);
    mockUserAgentRepo.findByUserId.mockResolvedValue(userAgent);
    mockAgentRunner.run.mockResolvedValue(runResult);

    const channel = mockChannel();
    const router = createRouter();

    await router.handleInbound(mockInbound(), channel);

    expect(channel.sendMessage).toHaveBeenCalledWith({
      recipientId: '123456',
      text: 'Response',
      metadata: {
        messageId: 'run-xyz',
        replyToMessageId: 'msg-1',
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

  it('sends error message via sendMessage when agent fails on a channel without sendError', async () => {
    mockUserRepo.findByTelegramId.mockResolvedValue({
      id: 'user-1',
      isActive: true,
    });
    mockUserAgentRepo.findByUserId.mockResolvedValue({
      agentDefinitionId: 'agent-1',
    });
    mockAgentRunner.run.mockRejectedValue(new Error('LLM timeout'));

    const channel = mockChannel();
    const router = createRouter();

    await router.handleInbound(mockInbound(), channel);

    expect(channel.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('went wrong'),
        metadata: expect.objectContaining({ replyToMessageId: 'msg-1' }),
      }),
    );
  });

  it('routes errors through channel.sendError when supported, with policy code for policy errors', async () => {
    mockUserRepo.findByTelegramId.mockResolvedValue({
      id: 'user-1',
      isActive: true,
    });
    mockUserAgentRepo.findByUserId.mockResolvedValue({
      agentDefinitionId: 'agent-1',
    });
    mockAgentRunner.run.mockRejectedValue(
      new Error("Provider 'openai' is not allowed by policy 'standard'"),
    );

    const channel: ChannelAdapter = {
      ...mockChannel(),
      sendError: vi.fn().mockResolvedValue(undefined),
    };
    const router = createRouter();

    await router.handleInbound(mockInbound(), channel);

    expect(channel.sendError).toHaveBeenCalledWith(
      '123456',
      'POLICY_DENIED',
      expect.stringMatching(/policy|administrator|plan/i),
    );
    // No empty session leaked into the DB.
    expect(mockSessionManager.getOrCreate).not.toHaveBeenCalled();
    // Fallback path is not used when sendError exists.
    expect(channel.sendMessage).not.toHaveBeenCalled();
  });

  it('does not pre-create a session when the agent run rejects', async () => {
    mockUserRepo.findByTelegramId.mockResolvedValue({
      id: 'user-1',
      isActive: true,
    });
    mockUserAgentRepo.findByUserId.mockResolvedValue({
      agentDefinitionId: 'agent-1',
    });
    mockAgentRunner.run.mockRejectedValue(
      new Error("Provider 'openai' is not allowed by policy 'standard'"),
    );

    const router = createRouter();
    await router.handleInbound(mockInbound(), mockChannel());

    expect(mockSessionManager.getOrCreate).not.toHaveBeenCalled();
  });

  it('should pass channel, chatId, and userName to agentRunner.run', async () => {
    const user = { id: 'user-1', telegramId: '123456', isActive: true };
    const userAgent = { agentDefinitionId: 'agent-1' };
    const runResult = {
      streamingUsed: false,
      sessionId: 'session-1',
      output: 'Hello human',
      status: 'completed',
      tokenUsage: { input: 10, output: 5 },
    };

    mockUserRepo.findByTelegramId.mockResolvedValue(user);
    mockUserAgentRepo.findByUserId.mockResolvedValue(userAgent);
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
    mockAgentRunner.run.mockResolvedValue({
      streamingUsed: false,
      sessionId: 'session-1',
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
    const runResult = {
      streamingUsed: false,
      sessionId: 'session-1',
      output: 'Hello from agent',
      status: 'completed',
      tokenUsage: { input: 10, output: 5 },
    };

    mockUserRepo.findById.mockResolvedValue(user);
    mockUserAgentRepo.findByUserId.mockResolvedValue(userAgent);
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
    const runResult = {
      streamingUsed: false,
      sessionId: 'session-1',
      output: 'Hello',
      status: 'completed',
      tokenUsage: { input: 10, output: 5 },
    };

    mockUserRepo.findByTelegramId.mockResolvedValue(user);
    mockUserAgentRepo.findByUserId.mockResolvedValue(userAgent);
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
        streamingUsed: false,
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

  describe('streaming multi-message', () => {
    const user = { id: 'user-1', telegramId: '123456', isActive: true };
    const userAgent = { agentDefinitionId: 'agent-1' };

    beforeEach(() => {
      mockUserRepo.findByTelegramId.mockResolvedValue(user);
      mockUserAgentRepo.findByUserId.mockResolvedValue(userAgent);
    });

    it('streams multiple sendMessage calls when agent has streamingEnabled', async () => {
      mockAgentDefRepo.findById.mockResolvedValue({ id: 'agent-1', streamingEnabled: true });
      // telegram channel-1 with no override → mode 'all' (platform default)
      mockChannelRepo.findById.mockResolvedValue({ id: 'channel-1', toolProgressMode: null });

      mockAgentRunner.run.mockImplementation(
        async (opts: { onEvent?: (e: unknown) => Promise<void> }) => {
          if (opts.onEvent) {
            await opts.onEvent({
              type: 'assistant_chunk',
              content: 'Looking it up.',
              isFinal: false,
            });
            await opts.onEvent({
              type: 'tool_started',
              name: 'web_search',
              args: { query: 'cats' },
            });
            await opts.onEvent({
              type: 'assistant_chunk',
              content: 'Cats are cool.',
              isFinal: true,
            });
          }
          return {
            streamingUsed: true,
            output: 'Cats are cool.',
            agentRunId: 'run-1',
            sessionId: 'session-1',
            status: 'completed',
            tokenUsage: { input: 10, output: 5 },
          };
        },
      );

      const channel = mockChannel();
      const router = createRouter();
      await router.handleInbound(mockInbound(), channel);

      expect(channel.sendMessage).toHaveBeenCalledTimes(3);
      const calls = (channel.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][0]).toMatchObject({ recipientId: '123456', text: 'Looking it up.' });
      expect(calls[1][0].text).toMatch(/^🔍 web_search:/);
      expect(calls[1][0].text).toContain('cats');
      expect(calls[2][0]).toMatchObject({ recipientId: '123456', text: 'Cats are cool.' });

      // Each streamed chunk must carry a unique messageId so the web client
      // doesn't dedupe them.
      const messageIds = (channel.sendMessage as ReturnType<typeof vi.fn>).mock.calls.map(
        (call) => (call[0].metadata as { messageId?: string } | undefined)?.messageId,
      );
      expect(messageIds.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
      expect(new Set(messageIds).size).toBe(messageIds.length); // all unique
    });

    it('does not send a trailing message when streamingUsed is true', async () => {
      mockAgentDefRepo.findById.mockResolvedValue({ id: 'agent-1', streamingEnabled: true });
      mockChannelRepo.findById.mockResolvedValue({ id: 'channel-1', toolProgressMode: null });

      mockAgentRunner.run.mockImplementation(
        async (opts: { onEvent?: (e: unknown) => Promise<void> }) => {
          if (opts.onEvent) {
            await opts.onEvent({
              type: 'assistant_chunk',
              content: 'Looking it up.',
              isFinal: false,
            });
            await opts.onEvent({
              type: 'tool_started',
              name: 'web_search',
              args: { query: 'cats' },
            });
            await opts.onEvent({
              type: 'assistant_chunk',
              content: 'Cats are cool.',
              isFinal: true,
            });
          }
          return {
            streamingUsed: true,
            output: 'Cats are cool.',
            agentRunId: 'run-1',
            sessionId: 'session-1',
            status: 'completed',
            tokenUsage: { input: 10, output: 5 },
          };
        },
      );

      const channel = mockChannel();
      const router = createRouter();
      await router.handleInbound(mockInbound(), channel);

      // Exactly 3 calls — no trailing single-message send duplicating the final answer
      expect(channel.sendMessage).toHaveBeenCalledTimes(3);
    });

    it('falls back to single-message send when streamingUsed is false', async () => {
      mockAgentDefRepo.findById.mockResolvedValue({ id: 'agent-1', streamingEnabled: false });
      mockChannelRepo.findById.mockResolvedValue({ id: 'channel-1', toolProgressMode: null });

      mockAgentRunner.run.mockResolvedValue({
        streamingUsed: false,
        output: 'final answer',
        agentRunId: 'run-2',
        sessionId: 'session-2',
        status: 'completed',
        tokenUsage: { input: 10, output: 5 },
      });

      const channel = mockChannel();
      const router = createRouter();
      await router.handleInbound(mockInbound(), channel);

      expect(channel.sendMessage).toHaveBeenCalledTimes(1);
      expect(channel.sendMessage).toHaveBeenCalledWith({
        recipientId: '123456',
        text: 'final answer',
        metadata: expect.objectContaining({ messageId: 'run-2' }),
      });
    });

    it('respects channel toolProgressMode override (off → no tool bubbles)', async () => {
      mockAgentDefRepo.findById.mockResolvedValue({ id: 'agent-1', streamingEnabled: true });
      // toolProgressMode 'off' overrides the telegram platform default of 'all'
      mockChannelRepo.findById.mockResolvedValue({ id: 'channel-1', toolProgressMode: 'off' });

      mockAgentRunner.run.mockImplementation(
        async (opts: { onEvent?: (e: unknown) => Promise<void> }) => {
          if (opts.onEvent) {
            await opts.onEvent({ type: 'assistant_chunk', content: 'Thinking…', isFinal: false });
            await opts.onEvent({
              type: 'tool_started',
              name: 'web_search',
              args: { query: 'dogs' },
            });
            await opts.onEvent({
              type: 'assistant_chunk',
              content: 'Dogs are loyal.',
              isFinal: true,
            });
          }
          return {
            streamingUsed: true,
            output: 'Dogs are loyal.',
            agentRunId: 'run-3',
            sessionId: 'session-3',
            status: 'completed',
            tokenUsage: { input: 10, output: 5 },
          };
        },
      );

      const channel = mockChannel();
      const router = createRouter();
      await router.handleInbound(mockInbound(), channel);

      // Only the 2 assistant_chunks were sent; no bubble for the tool_started event
      expect(channel.sendMessage).toHaveBeenCalledTimes(2);
      const calls = (channel.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][0]).toMatchObject({ recipientId: '123456', text: 'Thinking…' });
      expect(calls[1][0]).toMatchObject({ recipientId: '123456', text: 'Dogs are loyal.' });
    });

    describe('edit-status-in-place', () => {
      // A streaming run: one prose chunk, then three consecutive tool calls,
      // then the final answer. Drives the status-consolidation path.
      function streamThreeTools(): void {
        mockAgentDefRepo.findById.mockResolvedValue({ id: 'agent-1', streamingEnabled: true });
        mockChannelRepo.findById.mockResolvedValue({ id: 'channel-1', toolProgressMode: null });
        mockAgentRunner.run.mockImplementation(
          async (opts: { onEvent?: (e: unknown) => Promise<void> }) => {
            if (opts.onEvent) {
              await opts.onEvent({ type: 'assistant_chunk', content: 'Working.', isFinal: false });
              await opts.onEvent({
                type: 'tool_started',
                name: 'web_search',
                args: { query: 'a' },
              });
              await opts.onEvent({ type: 'tool_started', name: 'read_file', args: { path: 'b' } });
              await opts.onEvent({ type: 'tool_started', name: 'shell_exec', args: { cmd: 'c' } });
              await opts.onEvent({ type: 'assistant_chunk', content: 'Done.', isFinal: true });
            }
            return {
              streamingUsed: true,
              output: 'Done.',
              agentRunId: 'run-1',
              sessionId: 'session-1',
              status: 'completed',
              tokenUsage: { input: 10, output: 5 },
            };
          },
        );
      }

      it('edits one status message in place across consecutive tool bubbles', async () => {
        streamThreeTools();
        const channel = mockChannel();
        // First bubble send returns the status anchor id.
        (channel.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue('status-1');
        channel.editMessage = vi.fn().mockResolvedValue(undefined);

        const router = createRouter();
        await router.handleInbound(mockInbound(), channel);

        // sendMessage: prose 'Working.', first tool bubble, final 'Done.' = 3.
        const sends = (channel.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
        expect(sends).toHaveLength(3);
        expect(sends[0][0].text).toBe('Working.');
        expect(sends[1][0].text).toMatch(/^🔍 web_search:/);
        expect(sends[2][0].text).toBe('Done.');

        // The 2nd and 3rd tools edit the same status anchor instead of appending.
        const edits = (channel.editMessage as ReturnType<typeof vi.fn>).mock.calls;
        expect(edits).toHaveLength(2);
        expect(edits[0]).toEqual(['123456', 'status-1', expect.stringMatching(/^📖 read_file:/)]);
        expect(edits[1]).toEqual(['123456', 'status-1', expect.stringMatching(/^💻 shell_exec:/)]);
      });

      it('appends a new message per tool when the adapter has no editMessage', async () => {
        streamThreeTools();
        const channel = mockChannel(); // no editMessage
        const router = createRouter();
        await router.handleInbound(mockInbound(), channel);

        // prose + 3 tool bubbles + final = 5 sends, no edits possible.
        expect(channel.sendMessage).toHaveBeenCalledTimes(5);
      });

      it('opens a fresh status message after an interleaved assistant_chunk', async () => {
        mockAgentDefRepo.findById.mockResolvedValue({ id: 'agent-1', streamingEnabled: true });
        mockChannelRepo.findById.mockResolvedValue({ id: 'channel-1', toolProgressMode: null });
        mockAgentRunner.run.mockImplementation(
          async (opts: { onEvent?: (e: unknown) => Promise<void> }) => {
            if (opts.onEvent) {
              // Group 1: two tools.
              await opts.onEvent({
                type: 'tool_started',
                name: 'web_search',
                args: { query: 'a' },
              });
              await opts.onEvent({ type: 'tool_started', name: 'read_file', args: { path: 'b' } });
              // Prose closes the group.
              await opts.onEvent({ type: 'assistant_chunk', content: 'Midway.', isFinal: false });
              // Group 2: one tool — must NOT edit group 1's anchor.
              await opts.onEvent({ type: 'tool_started', name: 'shell_exec', args: { cmd: 'c' } });
              await opts.onEvent({ type: 'assistant_chunk', content: 'Done.', isFinal: true });
            }
            return {
              streamingUsed: true,
              output: 'Done.',
              agentRunId: 'run-1',
              sessionId: 'session-1',
              status: 'completed',
              tokenUsage: { input: 10, output: 5 },
            };
          },
        );

        const channel = mockChannel();
        (channel.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue('status-1');
        channel.editMessage = vi.fn().mockResolvedValue(undefined);

        const router = createRouter();
        await router.handleInbound(mockInbound(), channel);

        // Sends: group-1 first tool, 'Midway.', group-2 first tool (fresh), 'Done.' = 4.
        expect(channel.sendMessage).toHaveBeenCalledTimes(4);
        // Only the 2nd tool of group 1 was an edit; group 2's tool opened fresh.
        expect(channel.editMessage).toHaveBeenCalledTimes(1);
      });

      it('falls back to a fresh send when editMessage rejects', async () => {
        streamThreeTools();
        const channel = mockChannel();
        (channel.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue('status-1');
        channel.editMessage = vi.fn().mockRejectedValue(new Error('edit failed'));

        const router = createRouter();
        await router.handleInbound(mockInbound(), channel);

        // prose + tool-1 send, then tool-2 edit fails → fresh send, tool-3 edit
        // fails → fresh send, + final = 5 sends. Both edits were attempted.
        expect(channel.sendMessage).toHaveBeenCalledTimes(5);
        expect(channel.editMessage).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('MessageRouterService.lookupUser (whatsapp)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockPrisma.agentRun.count.mockResolvedValue(0);
      mockCommandService.isSlashPrefixed.mockReturnValue(false);
    });

    it('looks up the user by whatsappJid for whatsapp channel messages', async () => {
      const user = {
        id: 'user-1',
        whatsappJid: '15551234567@s.whatsapp.net',
        isActive: true,
      };
      mockUserRepo.findByWhatsappJid.mockResolvedValue(user);
      mockUserAgentRepo.findByUserId.mockResolvedValue(null); // route returns "no agent" early

      const channel: ChannelAdapter = {
        id: 'channel-wa',
        type: 'whatsapp',
        connect: vi.fn(),
        disconnect: vi.fn(),
        sendMessage: vi.fn().mockResolvedValue(undefined),
        onMessage: vi.fn(),
      };
      const router = createRouter();

      const inbound: InboundMessage = {
        channelType: 'whatsapp',
        channelMessageId: 'wa-1',
        senderId: '15551234567@s.whatsapp.net',
        senderName: 'Alice',
        text: 'hi',
        timestamp: new Date(),
      };

      await router.handleInbound(inbound, channel);

      expect(mockUserRepo.findByWhatsappJid).toHaveBeenCalledWith('15551234567@s.whatsapp.net');
      expect(mockUserRepo.findByTelegramId).not.toHaveBeenCalled();
    });
  });
});
