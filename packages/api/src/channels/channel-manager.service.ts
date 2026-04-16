import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createLogger } from '@clawix/shared';
import type { ChannelAdapter, InboundMessage } from '@clawix/shared';

import { ChannelRepository } from '../db/channel.repository.js';
import { ChannelRegistry } from './channel.registry.js';
import { decryptChannelConfig } from './channel-config-crypto.js';
import { MessageRouterService } from './message-router.service.js';
import { RedisPubSubService } from '../cache/redis-pubsub.service.js';
import { SessionRepository } from '../db/session.repository.js';
import { UserRepository } from '../db/user.repository.js';
import { PUBSUB_CHANNELS } from '../cache/cache.constants.js';

const logger = createLogger('channels:manager');

/** Payload shape published on the channelResponseReady pub/sub channel. */
interface ChannelResponsePayload {
  readonly sessionId: string;
  readonly output: string;
}

/** Payload shape published on the cronResultReady pub/sub channel. */
interface CronResultPayload {
  readonly channelId: string;
  readonly userId: string;
  readonly taskId: string;
  readonly output: string;
}

@Injectable()
export class ChannelManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly activeChannels: ChannelAdapter[] = [];

  constructor(
    private readonly channelRepo: ChannelRepository,
    private readonly registry: ChannelRegistry,
    private readonly router: MessageRouterService,
    private readonly pubsub: RedisPubSubService,
    private readonly sessionRepo: SessionRepository,
    private readonly userRepo: UserRepository,
  ) {}

  // ---------------------------------------------------------------- //
  //  Public methods                                                   //
  // ---------------------------------------------------------------- //

  /** Look up an active channel adapter by its database channel ID. */
  findByChannelId(channelId: string): ChannelAdapter | undefined {
    return this.activeChannels.find((ch) => ch.id === channelId);
  }

  /** Return the IDs of all currently connected (running) channels. */
  getConnectedChannelIds(): readonly string[] {
    return this.activeChannels.map((ch) => ch.id);
  }

  // ---------------------------------------------------------------- //
  //  Lifecycle                                                        //
  // ---------------------------------------------------------------- //

  async onModuleInit(): Promise<void> {
    await this.ensureWebChannelExists();
    await this.startAll();
    await this.subscribeToResponseDelivery();
    await this.subscribeToCronResults();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopAll();
  }

  async startAll(): Promise<void> {
    const dbChannels = await this.channelRepo.findActive();
    logger.info({ count: dbChannels.length }, 'Starting active channels');

    for (const dbChannel of dbChannels) {
      try {
        const channel = this.registry.create(dbChannel.type, {
          id: dbChannel.id,
          type: dbChannel.type,
          name: dbChannel.name,
          config: decryptChannelConfig(
            dbChannel.type,
            (dbChannel.config ?? {}) as Record<string, unknown>,
          ),
        });

        // Wire message handler
        channel.onMessage(async (message: InboundMessage) => {
          await this.router.handleInbound(message, channel);
        });

        await channel.connect();
        this.activeChannels.push(channel);
        logger.info({ channelId: dbChannel.id, type: dbChannel.type }, 'Channel started');
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(
          { channelId: dbChannel.id, type: dbChannel.type, error: errorMsg },
          'Failed to start channel',
        );
      }
    }
  }

  async stopAll(): Promise<void> {
    logger.info({ count: this.activeChannels.length }, 'Stopping all channels');

    const stopPromises = this.activeChannels.map(async (channel) => {
      try {
        await channel.disconnect();
        logger.info({ channelId: channel.id }, 'Channel stopped');
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error({ channelId: channel.id, error: errorMsg }, 'Failed to stop channel');
      }
    });

    await Promise.race([
      Promise.all(stopPromises),
      new Promise((resolve) => setTimeout(resolve, 30_000)),
    ]);

    this.activeChannels.length = 0;
  }

  /**
   * Stop all running channels and re-start from the current DB state.
   * Call this after channel config changes (create, update, delete).
   */
  async reloadAll(): Promise<void> {
    logger.info('Reloading all channels');
    await this.stopAll();
    await this.startAll();
    logger.info({ count: this.activeChannels.length }, 'Channel reload complete');
  }

  // ---------------------------------------------------------------- //
  //  Response delivery                                                //
  // ---------------------------------------------------------------- //

  /**
   * Subscribe to channelResponseReady pub/sub events.
   * When a re-invoked parent agent produces a response, this delivers
   * it to the original channel (e.g. Telegram).
   */
  private async subscribeToResponseDelivery(): Promise<void> {
    await this.pubsub.subscribe<ChannelResponsePayload>(
      PUBSUB_CHANNELS.channelResponseReady,
      async (msg) => {
        const payload = msg.payload;
        if (!payload?.sessionId || !payload?.output) return;

        await this.deliverResponseToChannel(payload.sessionId, payload.output);
      },
    );
  }

  /**
   * Subscribe to cronResultReady pub/sub events.
   * Delivers cron job output to the task's configured channel.
   */
  private async subscribeToCronResults(): Promise<void> {
    await this.pubsub.subscribe<CronResultPayload>(PUBSUB_CHANNELS.cronResultReady, async (msg) => {
      const payload = msg.payload;
      if (!payload?.channelId || !payload?.userId || !payload?.output) return;

      await this.deliverCronResult(payload);
    });
  }

  private async deliverCronResult(payload: CronResultPayload): Promise<void> {
    try {
      const adapter = this.findByChannelId(payload.channelId);
      if (!adapter) {
        logger.warn(
          { channelId: payload.channelId, taskId: payload.taskId },
          'No active adapter for cron delivery',
        );
        return;
      }

      const user = await this.userRepo.findById(payload.userId);
      const recipientId = this.resolveRecipientId(adapter.type, user);
      if (!recipientId) {
        logger.warn(
          { channelType: adapter.type, userId: user.id },
          'Could not resolve recipient ID',
        );
        return;
      }

      await adapter.sendMessage({ recipientId, text: payload.output });
      logger.info(
        { taskId: payload.taskId, channelId: payload.channelId, recipientId },
        'Delivered cron result to channel',
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ taskId: payload.taskId, error: message }, 'Failed to deliver cron result');
    }
  }

  /**
   * Look up the session's channel and user, then deliver the response
   * via the appropriate channel adapter.
   */
  private async deliverResponseToChannel(sessionId: string, output: string): Promise<void> {
    try {
      const session = await this.sessionRepo.findById(sessionId);

      if (!session.channelId) {
        logger.debug({ sessionId }, 'Session has no channelId; skipping channel delivery');
        return;
      }

      const adapter = this.findByChannelId(session.channelId);
      if (!adapter) {
        logger.warn({ sessionId, channelId: session.channelId }, 'No active adapter for channel');
        return;
      }

      const user = await this.userRepo.findById(session.userId);

      // Resolve the recipient's external platform ID based on channel type
      const recipientId = this.resolveRecipientId(adapter.type, user);
      if (!recipientId) {
        logger.warn(
          { channelType: adapter.type, userId: user.id },
          'Could not resolve recipient ID',
        );
        return;
      }

      // Send to channel
      await adapter.sendMessage({ recipientId, text: output });

      logger.info(
        { sessionId, channelId: session.channelId, recipientId },
        'Delivered re-invocation response to channel',
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        { sessionId, error: message },
        'Failed to deliver re-invocation response to channel',
      );
    }
  }

  // ---------------------------------------------------------------- //
  //  Private helpers                                                  //
  // ---------------------------------------------------------------- //

  private async ensureWebChannelExists(): Promise<void> {
    const existing = await this.channelRepo.findByType('web');
    if (existing.length > 0) {
      logger.info('Web channel already exists, skipping auto-seed');
      return;
    }

    await this.channelRepo.create({
      type: 'web',
      name: 'Web Dashboard',
      config: {},
    });
    logger.info('Auto-seeded web channel');
  }

  private resolveRecipientId(
    channelType: string,
    user: { id: string; telegramId?: string | null },
  ): string | null {
    switch (channelType) {
      case 'web':
        return user.id;
      case 'telegram':
        return user.telegramId ?? null;
      default:
        logger.warn({ channelType }, 'No recipient resolver for channel type');
        return null;
    }
  }
}
