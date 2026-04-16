import { Bot } from 'grammy';
import { createLogger } from '@clawix/shared';
import type {
  ChannelAdapter,
  ChannelAdapterConfig,
  InboundMessage,
  MessageHandler,
  OutboundMessage,
} from '@clawix/shared';

import { formatMarkdownV2 } from './telegram.formatter.js';

const logger = createLogger('channels:telegram');

/**
 * Create a Telegram channel adapter using grammy.
 * Supports polling (default) and webhook modes.
 */
export function createTelegramAdapter(config: ChannelAdapterConfig): ChannelAdapter {
  const botToken = config.config['bot_token'] as string | undefined;

  if (!botToken) {
    throw new Error(
      'Telegram bot token is required — set config.bot_token in the channel configuration',
    );
  }

  const mode = (config.config['mode'] as string | undefined) ?? 'polling';
  const bot = new Bot(botToken);
  let messageHandler: MessageHandler | null = null;

  // Handle /start command
  bot.command('start', async (ctx) => {
    logger.info({ chatId: ctx.chat.id }, 'Received /start command');
    await ctx.reply(
      'Welcome to Clawix! Send me a message and I will route it to your assigned agent.',
    );
  });

  // Handle text messages
  bot.on('message:text', async (ctx) => {
    if (!messageHandler) {
      logger.warn('No message handler registered, ignoring message');
      return;
    }

    const from = ctx.from;
    if (!from) {
      return;
    }

    const inbound: InboundMessage = {
      channelType: 'telegram',
      channelMessageId: String(ctx.message.message_id),
      senderId: String(from.id),
      senderName: [from.first_name, from.last_name].filter(Boolean).join(' '),
      text: ctx.message.text,
      timestamp: new Date(ctx.message.date * 1000),
      rawPayload: ctx.message,
    };

    try {
      await messageHandler(inbound);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ chatId: ctx.chat.id, error: errorMsg }, 'Error handling message');
    }
  });

  const adapter: ChannelAdapter = {
    id: config.id,
    type: 'telegram',

    async connect(): Promise<void> {
      if (mode === 'webhook') {
        const webhookUrl = config.config['webhook_url'] as string | undefined;
        const secret = config.config['webhook_secret'] as string | undefined;

        if (!webhookUrl) {
          throw new Error('webhook_url is required in channel config for webhook mode');
        }

        logger.info({ webhookUrl }, 'Setting Telegram webhook');
        await bot.api.setWebhook(webhookUrl, {
          ...(secret ? { secret_token: secret } : {}),
        });

        // Note: Webhook HTTP endpoint (POST /api/telegram/webhook) must be
        // registered on the Fastify instance separately. For initial deployment,
        // use polling mode (default).
        logger.warn('Webhook mode: ensure POST /api/telegram/webhook route is registered');
      } else {
        logger.info('Starting Telegram bot in polling mode');
        bot.start({
          onStart: () => {
            logger.info('Telegram bot polling started');
          },
        });
      }
    },

    async disconnect(): Promise<void> {
      logger.info('Stopping Telegram bot');
      await bot.stop();
    },

    async sendMessage(message: OutboundMessage): Promise<void> {
      const chatId = message.recipientId;
      const formatted = formatMarkdownV2(message.text);

      try {
        await bot.api.sendMessage(chatId, formatted, { parse_mode: 'MarkdownV2' });
      } catch {
        // Fallback: send as plain text if MarkdownV2 fails
        logger.warn({ chatId }, 'MarkdownV2 send failed, retrying as plain text');
        await bot.api.sendMessage(chatId, message.text);
      }
    },

    async sendTyping(recipientId: string): Promise<void> {
      await bot.api.sendChatAction(recipientId, 'typing');
    },

    onMessage(handler: MessageHandler): void {
      messageHandler = handler;
    },
  };

  return adapter;
}
