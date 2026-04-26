import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ChannelManagerService } from '../channel-manager.service.js';
import type { ChannelAdapter } from '@clawix/shared';
import { PUBSUB_CHANNELS } from '../../cache/cache.constants.js';

function mockChannel(overrides?: Partial<ChannelAdapter>): ChannelAdapter {
  return {
    id: 'ch-1',
    type: 'telegram',
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn(),
    ...overrides,
  };
}

describe('ChannelManagerService', () => {
  const mockChannelRepo = {
    findActive: vi.fn(),
    findByType: vi.fn(),
    create: vi.fn(),
  };
  const mockRegistry = {
    create: vi.fn(),
    getRegistered: vi.fn().mockReturnValue(['telegram']),
  };
  const mockRouter = {
    handleInbound: vi.fn(),
  };
  const mockPubsub = {
    subscribe: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(1),
  };
  const mockSessionRepo = {
    findById: vi.fn(),
  };
  const mockUserRepo = {
    findById: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: web channel already exists so auto-seed is a no-op in most tests
    mockChannelRepo.findByType.mockResolvedValue([{ id: 'web-ch', type: 'web' }]);
    mockChannelRepo.create.mockResolvedValue({ id: 'web-ch-new', type: 'web' });
  });

  function createManager() {
    return new ChannelManagerService(
      mockChannelRepo as never,
      mockRegistry as never,
      mockRouter as never,
      mockPubsub as never,
      mockSessionRepo as never,
      mockUserRepo as never,
    );
  }

  it('starts all active channels from DB', async () => {
    const dbChannel = {
      id: 'ch-1',
      type: 'telegram',
      name: 'Bot',
      config: { botToken: 'test' },
      isActive: true,
    };
    mockChannelRepo.findActive.mockResolvedValue([dbChannel]);

    const channel = mockChannel();
    mockRegistry.create.mockReturnValue(channel);

    const manager = createManager();
    await manager.startAll();

    expect(mockRegistry.create).toHaveBeenCalledWith(
      'telegram',
      expect.objectContaining({
        id: 'ch-1',
        type: 'telegram',
      }),
    );
    expect(channel.connect).toHaveBeenCalled();
    expect(channel.onMessage).toHaveBeenCalled();
  });

  it('continues starting other channels when one fails', async () => {
    const channels = [
      { id: 'ch-1', type: 'telegram', name: 'Bot1', config: {}, isActive: true },
      { id: 'ch-2', type: 'telegram', name: 'Bot2', config: {}, isActive: true },
    ];
    mockChannelRepo.findActive.mockResolvedValue(channels);

    const failChannel = mockChannel({ connect: vi.fn().mockRejectedValue(new Error('fail')) });
    const goodChannel = mockChannel();
    mockRegistry.create.mockReturnValueOnce(failChannel).mockReturnValueOnce(goodChannel);

    const manager = createManager();
    await manager.startAll();

    expect(failChannel.connect).toHaveBeenCalled();
    expect(goodChannel.connect).toHaveBeenCalled();
  });

  describe('findByChannelId', () => {
    it('returns the active adapter matching the given channel ID', async () => {
      const dbChannel = {
        id: 'ch-1',
        type: 'telegram',
        name: 'Bot',
        config: { botToken: 'test' },
        isActive: true,
      };
      mockChannelRepo.findActive.mockResolvedValue([dbChannel]);

      const channel = mockChannel({ id: 'ch-1' });
      mockRegistry.create.mockReturnValue(channel);

      const manager = createManager();
      await manager.startAll();

      expect(manager.findByChannelId('ch-1')).toBe(channel);
    });

    it('returns undefined when no adapter matches the channel ID', async () => {
      mockChannelRepo.findActive.mockResolvedValue([]);

      const manager = createManager();
      await manager.startAll();

      expect(manager.findByChannelId('ch-nonexistent')).toBeUndefined();
    });
  });

  describe('response delivery', () => {
    it('subscribes to channelResponseReady on module init', async () => {
      mockChannelRepo.findActive.mockResolvedValue([]);

      const manager = createManager();
      await manager.onModuleInit();

      expect(mockPubsub.subscribe).toHaveBeenCalledWith(
        PUBSUB_CHANNELS.channelResponseReady,
        expect.any(Function),
      );
    });

    it('sends response to the correct channel adapter when event fires', async () => {
      const dbChannel = {
        id: 'ch-telegram',
        type: 'telegram',
        name: 'Bot',
        config: {},
        isActive: true,
      };
      mockChannelRepo.findActive.mockResolvedValue([dbChannel]);

      const channel = mockChannel({ id: 'ch-telegram' });
      mockRegistry.create.mockReturnValue(channel);

      mockSessionRepo.findById.mockResolvedValue({
        id: 'sess-1',
        userId: 'user-1',
        channelId: 'ch-telegram',
        agentDefinitionId: 'agent-def-1',
      });
      mockUserRepo.findById.mockResolvedValue({
        id: 'user-1',
        telegramId: '12345',
        name: 'Test User',
      });

      const manager = createManager();
      await manager.onModuleInit();

      // Get the subscription handler
      const subscribeCb = mockPubsub.subscribe.mock.calls[0]![1] as (msg: {
        payload: { sessionId: string; output: string };
      }) => Promise<void>;

      await subscribeCb({ payload: { sessionId: 'sess-1', output: 'Here are the results...' } });

      expect(channel.sendMessage).toHaveBeenCalledWith({
        recipientId: '12345',
        text: 'Here are the results...',
        metadata: {
          messageId: expect.stringContaining('reinvoke-sess-1-'),
          sessionId: 'sess-1',
        },
      });
    });

    it('delivers response without separate message persistence', async () => {
      const dbChannel = {
        id: 'ch-telegram',
        type: 'telegram',
        name: 'Bot',
        config: {},
        isActive: true,
      };
      mockChannelRepo.findActive.mockResolvedValue([dbChannel]);

      const channel = mockChannel({ id: 'ch-telegram' });
      mockRegistry.create.mockReturnValue(channel);

      mockSessionRepo.findById.mockResolvedValue({
        id: 'sess-1',
        userId: 'user-1',
        channelId: 'ch-telegram',
      });
      mockUserRepo.findById.mockResolvedValue({
        id: 'user-1',
        telegramId: '12345',
      });

      const manager = createManager();
      await manager.onModuleInit();

      const subscribeCb = mockPubsub.subscribe.mock.calls[0]![1] as (msg: {
        payload: { sessionId: string; output: string };
      }) => Promise<void>;

      await subscribeCb({ payload: { sessionId: 'sess-1', output: 'Result text' } });

      expect(channel.sendMessage).toHaveBeenCalledWith({
        recipientId: '12345',
        text: 'Result text',
        metadata: {
          messageId: expect.stringContaining('reinvoke-sess-1-'),
          sessionId: 'sess-1',
        },
      });
    });

    it('skips delivery when session has no channelId (internal channel)', async () => {
      mockChannelRepo.findActive.mockResolvedValue([]);
      mockSessionRepo.findById.mockResolvedValue({
        id: 'sess-internal',
        userId: 'user-1',
        channelId: null,
      });

      const manager = createManager();
      await manager.onModuleInit();

      const subscribeCb = mockPubsub.subscribe.mock.calls[0]![1] as (msg: {
        payload: { sessionId: string; output: string };
      }) => Promise<void>;

      await subscribeCb({ payload: { sessionId: 'sess-internal', output: 'result' } });

      expect(mockUserRepo.findById).not.toHaveBeenCalled();
    });

    it('skips delivery when no active adapter found for channelId', async () => {
      mockChannelRepo.findActive.mockResolvedValue([]);
      mockSessionRepo.findById.mockResolvedValue({
        id: 'sess-1',
        userId: 'user-1',
        channelId: 'ch-gone',
      });

      const manager = createManager();
      await manager.onModuleInit();

      const subscribeCb = mockPubsub.subscribe.mock.calls[0]![1] as (msg: {
        payload: { sessionId: string; output: string };
      }) => Promise<void>;

      await subscribeCb({ payload: { sessionId: 'sess-1', output: 'result' } });

      expect(mockUserRepo.findById).not.toHaveBeenCalled();
    });

    it('skips delivery when user has no telegramId', async () => {
      const dbChannel = {
        id: 'ch-telegram',
        type: 'telegram',
        name: 'Bot',
        config: {},
        isActive: true,
      };
      mockChannelRepo.findActive.mockResolvedValue([dbChannel]);

      const channel = mockChannel({ id: 'ch-telegram' });
      mockRegistry.create.mockReturnValue(channel);

      mockSessionRepo.findById.mockResolvedValue({
        id: 'sess-1',
        userId: 'user-1',
        channelId: 'ch-telegram',
      });
      mockUserRepo.findById.mockResolvedValue({
        id: 'user-1',
        telegramId: null,
      });

      const manager = createManager();
      await manager.onModuleInit();

      const subscribeCb = mockPubsub.subscribe.mock.calls[0]![1] as (msg: {
        payload: { sessionId: string; output: string };
      }) => Promise<void>;

      await subscribeCb({ payload: { sessionId: 'sess-1', output: 'result' } });

      expect(channel.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('cron result delivery', () => {
    it('subscribes to cronResultReady on module init', async () => {
      mockChannelRepo.findActive.mockResolvedValue([]);

      const manager = createManager();
      await manager.onModuleInit();

      expect(mockPubsub.subscribe).toHaveBeenCalledWith(
        PUBSUB_CHANNELS.cronResultReady,
        expect.any(Function),
      );
    });

    it('delivers cron result to the correct channel adapter', async () => {
      const dbChannel = {
        id: 'ch-telegram',
        type: 'telegram',
        name: 'Bot',
        config: {},
        isActive: true,
      };
      mockChannelRepo.findActive.mockResolvedValue([dbChannel]);

      const channel = mockChannel({ id: 'ch-telegram' });
      mockRegistry.create.mockReturnValue(channel);

      mockUserRepo.findById.mockResolvedValue({
        id: 'user-1',
        telegramId: '12345',
      });

      const manager = createManager();
      await manager.onModuleInit();

      // cronResultReady is the second subscription (index 1)
      const cronCb = mockPubsub.subscribe.mock.calls[1]![1] as (msg: {
        payload: {
          status: 'success';
          channelId: string;
          userId: string;
          taskId: string;
          taskName: string;
          output: string;
        };
      }) => Promise<void>;

      await cronCb({
        payload: {
          status: 'success',
          channelId: 'ch-telegram',
          userId: 'user-1',
          taskId: 'task-1',
          taskName: 'Water Reminder',
          output: 'Time to drink water!',
        },
      });

      expect(channel.sendMessage).toHaveBeenCalledWith({
        recipientId: '12345',
        text: 'Time to drink water!',
      });
    });

    it('skips cron delivery when no active adapter found', async () => {
      mockChannelRepo.findActive.mockResolvedValue([]);

      const manager = createManager();
      await manager.onModuleInit();

      const cronCb = mockPubsub.subscribe.mock.calls[1]![1] as (msg: {
        payload: {
          status: 'success';
          channelId: string;
          userId: string;
          taskId: string;
          taskName: string;
          output: string;
        };
      }) => Promise<void>;

      await cronCb({
        payload: {
          status: 'success',
          channelId: 'ch-gone',
          userId: 'user-1',
          taskId: 'task-1',
          taskName: 'Job',
          output: 'result',
        },
      });

      expect(mockUserRepo.findById).not.toHaveBeenCalled();
    });

    it('delivers failure message text to the channel adapter when payload status is failed', async () => {
      const dbChannel = {
        id: 'ch-telegram',
        type: 'telegram',
        name: 'Bot',
        config: {},
        isActive: true,
      };
      mockChannelRepo.findActive.mockResolvedValue([dbChannel]);

      const channel = mockChannel({ id: 'ch-telegram' });
      mockRegistry.create.mockReturnValue(channel);

      mockUserRepo.findById.mockResolvedValue({
        id: 'user-1',
        telegramId: '12345',
      });

      const manager = createManager();
      await manager.onModuleInit();

      const cronCb = mockPubsub.subscribe.mock.calls[1]![1] as (msg: {
        payload:
          | {
              status: 'success';
              channelId: string;
              userId: string;
              taskId: string;
              taskName: string;
              output: string;
            }
          | {
              status: 'failed';
              channelId: string;
              userId: string;
              taskId: string;
              taskName: string;
              message: string;
              autoDisabled: boolean;
            };
      }) => Promise<void>;

      await cronCb({
        payload: {
          status: 'failed',
          channelId: 'ch-telegram',
          userId: 'user-1',
          taskId: 'task-1',
          taskName: 'Water Reminder',
          message: '⚠️ Task "Water Reminder" failed: timed out.',
          autoDisabled: false,
        },
      });

      expect(channel.sendMessage).toHaveBeenCalledWith({
        recipientId: '12345',
        text: '⚠️ Task "Water Reminder" failed: timed out.',
      });
    });

    it('does not deliver when payload status is neither success nor failed', async () => {
      const dbChannel = {
        id: 'ch-telegram',
        type: 'telegram',
        name: 'Bot',
        config: {},
        isActive: true,
      };
      mockChannelRepo.findActive.mockResolvedValue([dbChannel]);

      const channel = mockChannel({ id: 'ch-telegram' });
      mockRegistry.create.mockReturnValue(channel);

      const manager = createManager();
      await manager.onModuleInit();

      const cronCb = mockPubsub.subscribe.mock.calls[1]![1] as (msg: {
        payload: Record<string, unknown>;
      }) => Promise<void>;

      await cronCb({
        payload: {
          status: 'pending', // not a valid discriminator
          channelId: 'ch-telegram',
          userId: 'user-1',
          taskId: 'task-1',
        },
      });

      expect(channel.sendMessage).not.toHaveBeenCalled();
      expect(mockUserRepo.findById).not.toHaveBeenCalled();
    });

    it('does not deliver when success payload is missing output', async () => {
      const dbChannel = {
        id: 'ch-telegram',
        type: 'telegram',
        name: 'Bot',
        config: {},
        isActive: true,
      };
      mockChannelRepo.findActive.mockResolvedValue([dbChannel]);

      const channel = mockChannel({ id: 'ch-telegram' });
      mockRegistry.create.mockReturnValue(channel);

      const manager = createManager();
      await manager.onModuleInit();

      const cronCb = mockPubsub.subscribe.mock.calls[1]![1] as (msg: {
        payload: Record<string, unknown>;
      }) => Promise<void>;

      await cronCb({
        payload: {
          status: 'success',
          channelId: 'ch-telegram',
          userId: 'user-1',
          taskId: 'task-1',
          taskName: 'Job',
          // output missing
        },
      });

      expect(channel.sendMessage).not.toHaveBeenCalled();
      expect(mockUserRepo.findById).not.toHaveBeenCalled();
    });

    it('does not deliver when failed payload is missing message', async () => {
      const dbChannel = {
        id: 'ch-telegram',
        type: 'telegram',
        name: 'Bot',
        config: {},
        isActive: true,
      };
      mockChannelRepo.findActive.mockResolvedValue([dbChannel]);

      const channel = mockChannel({ id: 'ch-telegram' });
      mockRegistry.create.mockReturnValue(channel);

      const manager = createManager();
      await manager.onModuleInit();

      const cronCb = mockPubsub.subscribe.mock.calls[1]![1] as (msg: {
        payload: Record<string, unknown>;
      }) => Promise<void>;

      await cronCb({
        payload: {
          status: 'failed',
          channelId: 'ch-telegram',
          userId: 'user-1',
          taskId: 'task-1',
          taskName: 'Job',
          autoDisabled: false,
          // message missing
        },
      });

      expect(channel.sendMessage).not.toHaveBeenCalled();
      expect(mockUserRepo.findById).not.toHaveBeenCalled();
    });

    it('skips cron delivery when user has no telegramId', async () => {
      const dbChannel = {
        id: 'ch-telegram',
        type: 'telegram',
        name: 'Bot',
        config: {},
        isActive: true,
      };
      mockChannelRepo.findActive.mockResolvedValue([dbChannel]);

      const channel = mockChannel({ id: 'ch-telegram' });
      mockRegistry.create.mockReturnValue(channel);

      mockUserRepo.findById.mockResolvedValue({
        id: 'user-1',
        telegramId: null,
      });

      const manager = createManager();
      await manager.onModuleInit();

      const cronCb = mockPubsub.subscribe.mock.calls[1]![1] as (msg: {
        payload: {
          status: 'success';
          channelId: string;
          userId: string;
          taskId: string;
          taskName: string;
          output: string;
        };
      }) => Promise<void>;

      await cronCb({
        payload: {
          status: 'success',
          channelId: 'ch-telegram',
          userId: 'user-1',
          taskId: 'task-1',
          taskName: 'Job',
          output: 'result',
        },
      });

      expect(channel.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('auto-seed web channel', () => {
    it('creates web channel on init when none exists', async () => {
      mockChannelRepo.findActive.mockResolvedValue([]);
      mockChannelRepo.findByType.mockResolvedValue([]);

      const manager = createManager();
      await manager.onModuleInit();

      expect(mockChannelRepo.create).toHaveBeenCalledWith({
        type: 'web',
        name: 'Web Dashboard',
        config: {},
      });
    });

    it('skips web channel creation when one already exists', async () => {
      mockChannelRepo.findActive.mockResolvedValue([]);
      mockChannelRepo.findByType.mockResolvedValue([
        { id: 'web-ch', type: 'web', name: 'Web Dashboard' },
      ]);

      const manager = createManager();
      await manager.onModuleInit();

      expect(mockChannelRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('resolveRecipientId', () => {
    it('uses user.id as recipientId for web channel delivery', async () => {
      const dbChannel = {
        id: 'ch-web',
        type: 'web',
        name: 'Web Dashboard',
        config: {},
        isActive: true,
      };
      mockChannelRepo.findActive.mockResolvedValue([dbChannel]);

      const channel = mockChannel({ id: 'ch-web', type: 'web' });
      mockRegistry.create.mockReturnValue(channel);

      mockSessionRepo.findById.mockResolvedValue({
        id: 'sess-web',
        userId: 'user-web-1',
        channelId: 'ch-web',
      });
      mockUserRepo.findById.mockResolvedValue({
        id: 'user-web-1',
        telegramId: null,
      });

      const manager = createManager();
      await manager.onModuleInit();

      const subscribeCb = mockPubsub.subscribe.mock.calls[0]![1] as (msg: {
        payload: { sessionId: string; output: string };
      }) => Promise<void>;

      await subscribeCb({ payload: { sessionId: 'sess-web', output: 'Hello from web' } });

      expect(channel.sendMessage).toHaveBeenCalledWith({
        recipientId: 'user-web-1',
        text: 'Hello from web',
        metadata: {
          messageId: expect.stringContaining('reinvoke-sess-web-'),
          sessionId: 'sess-web',
        },
      });
    });

    it('uses user.telegramId as recipientId for telegram channel delivery', async () => {
      const dbChannel = {
        id: 'ch-tg',
        type: 'telegram',
        name: 'Bot',
        config: {},
        isActive: true,
      };
      mockChannelRepo.findActive.mockResolvedValue([dbChannel]);

      const channel = mockChannel({ id: 'ch-tg', type: 'telegram' });
      mockRegistry.create.mockReturnValue(channel);

      mockSessionRepo.findById.mockResolvedValue({
        id: 'sess-tg',
        userId: 'user-tg-1',
        channelId: 'ch-tg',
      });
      mockUserRepo.findById.mockResolvedValue({
        id: 'user-tg-1',
        telegramId: '99999',
      });

      const manager = createManager();
      await manager.onModuleInit();

      const subscribeCb = mockPubsub.subscribe.mock.calls[0]![1] as (msg: {
        payload: { sessionId: string; output: string };
      }) => Promise<void>;

      await subscribeCb({ payload: { sessionId: 'sess-tg', output: 'Hello from tg' } });

      expect(channel.sendMessage).toHaveBeenCalledWith({
        recipientId: '99999',
        text: 'Hello from tg',
        metadata: {
          messageId: expect.stringContaining('reinvoke-sess-tg-'),
          sessionId: 'sess-tg',
        },
      });
    });
  });

  it('stops all active channels', async () => {
    const dbChannel = {
      id: 'ch-1',
      type: 'telegram',
      name: 'Bot',
      config: {},
      isActive: true,
    };
    mockChannelRepo.findActive.mockResolvedValue([dbChannel]);

    const channel = mockChannel();
    mockRegistry.create.mockReturnValue(channel);

    const manager = createManager();
    await manager.startAll();
    await manager.stopAll();

    expect(channel.disconnect).toHaveBeenCalled();
  });
});
