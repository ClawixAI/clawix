import path from 'node:path';
import { createLogger } from '@clawix/shared';
import type {
  ChannelAdapter,
  ChannelAdapterConfig,
  InboundMessage,
  MessageHandler,
  OutboundMessage,
} from '@clawix/shared';

import { SAFE_SPLIT_LENGTH, splitMessage } from '../utils/message-chunker.js';
import { formatWhatsAppText } from './whatsapp.formatter.js';
import { createBaileysConnection, type WhatsAppConnection } from './whatsapp.lifecycle.js';

const logger = createLogger('channels:whatsapp');

const DEFAULT_AUTH_BASE = process.env['WHATSAPP_AUTH_DIR'] ?? 'data/whatsapp-auth';

interface BaileysKey {
  readonly id?: string;
  readonly remoteJid?: string;
  readonly fromMe?: boolean;
}

interface BaileysMessage {
  readonly conversation?: string;
  readonly extendedTextMessage?: { readonly text?: string };
}

interface BaileysUpsertItem {
  readonly key?: BaileysKey;
  readonly messageTimestamp?: number;
  readonly pushName?: string;
  readonly message?: BaileysMessage;
}

interface BaileysUpsertEvent {
  readonly messages?: BaileysUpsertItem[];
  readonly type?: string;
}

function resolveAuthDir(config: ChannelAdapterConfig): string {
  const fromConfig = config.config['auth_dir'];
  if (typeof fromConfig === 'string' && fromConfig.length > 0) {
    return fromConfig;
  }
  return path.join(DEFAULT_AUTH_BASE, config.id);
}

function extractText(message: BaileysMessage | undefined): string | null {
  if (!message) return null;
  if (typeof message.conversation === 'string' && message.conversation.length > 0) {
    return message.conversation;
  }
  const extended = message.extendedTextMessage?.text;
  if (typeof extended === 'string' && extended.length > 0) {
    return extended;
  }
  return null;
}

function shouldSkip(item: BaileysUpsertItem): boolean {
  const key = item.key;
  if (!key || !key.id || !key.remoteJid) return true;
  if (key.fromMe === true) return true;
  if (key.remoteJid.endsWith('@g.us')) return true; // group — deferred to 4B.7
  if (key.remoteJid === 'status@broadcast') return true; // status updates
  return false;
}

export function createWhatsAppAdapter(config: ChannelAdapterConfig): ChannelAdapter {
  const authDir = resolveAuthDir(config);
  let connection: WhatsAppConnection | null = null;
  let messageHandler: MessageHandler | null = null;

  const onUpsert = (raw: unknown): void => {
    const event = raw as BaileysUpsertEvent;
    const items = event.messages;
    if (!Array.isArray(items)) return;

    for (const item of items) {
      if (shouldSkip(item)) {
        logger.debug({ key: item.key }, 'Skipping inbound message');
        continue;
      }
      const text = extractText(item.message);
      if (text === null) {
        logger.debug({ id: item.key?.id }, 'Skipping non-text message (media deferred)');
        continue;
      }
      if (!messageHandler) {
        logger.warn('Inbound message arrived before onMessage handler was registered');
        return;
      }

      const inbound: InboundMessage = {
        channelType: 'whatsapp',
        channelMessageId: item.key!.id!,
        senderId: item.key!.remoteJid!,
        senderName: item.pushName && item.pushName.length > 0 ? item.pushName : 'WhatsApp User',
        text,
        timestamp: new Date((item.messageTimestamp ?? Math.floor(Date.now() / 1000)) * 1000),
      };

      messageHandler(inbound).catch((err: unknown) => {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'message handler threw',
        );
      });
    }
  };

  return {
    id: config.id,
    type: 'whatsapp',

    async connect(): Promise<void> {
      logger.info({ authDir }, 'Starting WhatsApp channel');
      connection = await createBaileysConnection({ authDir, onMessage: onUpsert });
    },

    async disconnect(): Promise<void> {
      logger.info('Stopping WhatsApp channel');
      const current = connection;
      connection = null;
      if (current) await current.close();
    },

    async sendMessage(message: OutboundMessage): Promise<void> {
      const conn = connection;
      if (!conn) {
        logger.warn({ recipientId: message.recipientId }, 'sendMessage before connect()');
        return;
      }
      const chunks = splitMessage(message.text, SAFE_SPLIT_LENGTH);
      for (const chunk of chunks) {
        const formatted = formatWhatsAppText(chunk);
        try {
          await conn.sendText(message.recipientId, formatted);
        } catch (err: unknown) {
          logger.error(
            {
              recipientId: message.recipientId,
              err: err instanceof Error ? err.message : String(err),
            },
            'sendText failed',
          );
        }
      }
    },

    async sendTyping(recipientId: string): Promise<void> {
      if (!connection) return;
      try {
        await connection.sendPresence('composing', recipientId);
      } catch (err: unknown) {
        logger.debug(
          { err: err instanceof Error ? err.message : String(err) },
          'sendPresence(composing) failed',
        );
      }
    },

    async sendTypingStop(recipientId: string): Promise<void> {
      if (!connection) return;
      try {
        await connection.sendPresence('paused', recipientId);
      } catch (err: unknown) {
        logger.debug(
          { err: err instanceof Error ? err.message : String(err) },
          'sendPresence(paused) failed',
        );
      }
    },

    onMessage(handler: MessageHandler): void {
      messageHandler = handler;
    },
  };
}
