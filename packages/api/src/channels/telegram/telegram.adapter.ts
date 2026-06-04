import { Bot } from 'grammy';
import type { Message } from 'grammy/types';
import { createLogger } from '@clawix/shared';
import type {
  ChannelAdapter,
  ChannelAdapterConfig,
  InboundMessage,
  MessageHandler,
  OutboundMessage,
} from '@clawix/shared';

import { formatMarkdownV2 } from './telegram.formatter.js';
import {
  SAFE_SPLIT_LENGTH,
  TELEGRAM_MAX_MESSAGE_LENGTH,
  splitMessage,
} from '../utils/message-chunker.js';

const logger = createLogger('channels:telegram');

/**
 * Outbound reply-threading mode (mirrors Hermes `reply_to_mode`):
 *   "off"   — never thread; replies are sent as standalone messages.
 *   "first" — thread only the first message of a response to the user's
 *             original message (default).
 *   "all"   — thread every message of a response to the original.
 */
type ReplyToMode = 'off' | 'first' | 'all';

const REPLY_TO_MODES: readonly ReplyToMode[] = ['off', 'first', 'all'];

function resolveReplyToMode(value: unknown): ReplyToMode {
  return typeof value === 'string' && (REPLY_TO_MODES as readonly string[]).includes(value)
    ? (value as ReplyToMode)
    : 'first';
}

/**
 * Decide whether the chunk at `chunkIndex` of a single outbound response should
 * thread to the user's original message. `chunkIndex` is the index within one
 * `sendMessage` call's split chunks; the router supplies the anchor on every
 * response send, so `"first"` threads the lead chunk of each call.
 */
function shouldThreadReply(mode: ReplyToMode, chunkIndex: number): boolean {
  switch (mode) {
    case 'off':
      return false;
    case 'all':
      return true;
    case 'first':
    default:
      return chunkIndex === 0;
  }
}

/** Parse the inbound reply-anchor from outbound metadata into a numeric id. */
function parseReplyAnchor(metadata: OutboundMessage['metadata']): number | null {
  const raw = metadata?.replyToMessageId;
  if (raw === undefined || raw === null) {
    return null;
  }
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const extractReplyContext = (message: Message): InboundMessage['replyCtx'] => {
  if (!message?.reply_to_message || !message.reply_to_message.text) {
    return undefined;
  }
  const replyInfo = message.reply_to_message;
  return {
    from: replyInfo.from
      ? { isBot: replyInfo.from?.is_bot ?? false, id: replyInfo.from.id, date: replyInfo.date }
      : undefined,
    text: replyInfo.text!,
  };
};

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
  const replyToMode = resolveReplyToMode(config.config['reply_to_mode']);
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
      replyCtx: extractReplyContext(ctx.message),
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

    async sendMessage(message: OutboundMessage): Promise<string | undefined> {
      const chatId = message.recipientId;
      const chunks = splitMessage(message.text, SAFE_SPLIT_LENGTH);

      if (chunks.length === 0) {
        return undefined;
      }

      const replyAnchor = parseReplyAnchor(message.metadata);

      // Per-chunk send options. When this chunk should thread to the user's
      // original message, attach `reply_parameters`; otherwise return undefined
      // so the plain-text path stays argument-identical to a non-threaded send.
      // `allow_sending_without_reply` makes Telegram deliver the message anyway
      // if the anchor was deleted — server-side resilience instead of brittle
      // error-string matching.
      const optionsForChunk = (chunkIndex: number): Record<string, unknown> | undefined =>
        replyAnchor !== null && shouldThreadReply(replyToMode, chunkIndex)
          ? {
              reply_parameters: {
                message_id: replyAnchor,
                allow_sending_without_reply: true,
              },
            }
          : undefined;

      // Track the last sent message id so callers can edit it in place (e.g.
      // consolidating tool-progress bubbles). Single-line bubbles are always
      // one chunk, so this is exactly the message to edit.
      let lastMessageId: number | undefined;

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        const formatted = formatMarkdownV2(chunk);
        const replyOptions = optionsForChunk(i);

        if (formatted.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
          logger.warn(
            { chatId, rawLen: chunk.length, formattedLen: formatted.length },
            'MarkdownV2 expansion exceeded Telegram limit, sending chunk as plain text',
          );
          const sent = await bot.api.sendMessage(chatId, chunk, replyOptions);
          lastMessageId = sent.message_id;
          continue;
        }

        try {
          const sent = await bot.api.sendMessage(chatId, formatted, {
            ...replyOptions,
            parse_mode: 'MarkdownV2',
          });
          lastMessageId = sent.message_id;
        } catch {
          logger.warn({ chatId }, 'MarkdownV2 send failed, retrying as plain text');
          const sent = await bot.api.sendMessage(chatId, chunk, replyOptions);
          lastMessageId = sent.message_id;
        }
      }

      return lastMessageId === undefined ? undefined : String(lastMessageId);
    },

    async editMessage(recipientId: string, messageId: string, text: string): Promise<void> {
      const chatId = recipientId;
      const id = Number(messageId);
      if (!Number.isInteger(id)) {
        return;
      }

      const formatted = formatMarkdownV2(text);

      // An edit targets a single existing message, so — unlike sendMessage — it
      // cannot split overflowing text across messages.
      if (formatted.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
        if (text.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
          // Even the raw form is over the cap: no edit can represent it. Fail
          // fast so the caller falls back to a fresh (splitting) send instead
          // of making doomed API calls.
          throw new Error('edit text exceeds Telegram message length limit');
        }
        // Only the MarkdownV2 expansion overflows — edit as plain text directly
        // (mirrors sendMessage's too-long-after-escaping fallback).
        logger.warn(
          { chatId, messageId, rawLen: text.length, formattedLen: formatted.length },
          'MarkdownV2 edit expansion exceeded Telegram limit, editing as plain text',
        );
        await bot.api.editMessageText(chatId, id, text);
        return;
      }

      try {
        await bot.api.editMessageText(chatId, id, formatted, { parse_mode: 'MarkdownV2' });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        // Editing to identical content is a Telegram no-op error, not a failure.
        if (msg.includes('message is not modified')) {
          return;
        }
        // MarkdownV2 parse failure → retry as plain text, mirroring sendMessage.
        logger.warn({ chatId, messageId }, 'MarkdownV2 edit failed, retrying as plain text');
        await bot.api.editMessageText(chatId, id, text);
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
