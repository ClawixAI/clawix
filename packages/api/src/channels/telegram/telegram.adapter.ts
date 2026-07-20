import { Bot } from 'grammy';
import type { Context } from 'grammy';
import type { Message } from 'grammy/types';
import { run, sequentialize, type RunnerHandle } from '@grammyjs/runner';
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
import type { ApprovalFramePayload } from '../../approvals/approval-delivery.service.js';
import type { ApprovalChoice } from '../../approvals/approval.types.js';
import type { ToolApprovalService } from '../../approvals/tool-approval.service.js';
import type { UserRepository } from '../../db/user.repository.js';

const logger = createLogger('channels:telegram');

/**
 * Ordering constraint for the runner's `sequentialize` middleware.
 *
 * Messages in the same chat process in arrival order (one lane per chat), while
 * different chats run concurrently — so one user's long agent run no longer
 * blocks everybody else's messages.
 *
 * Callback queries deliberately get NO constraint, so they bypass the lane
 * entirely. This is load-bearing, not an optimisation: an approval prompt is
 * raised from *inside* the message handler (`ToolApprovalService.gate()` parks
 * the reasoning loop until a human answers), so that handler still occupies its
 * chat's lane while the prompt is live. Putting the tap in the same lane would
 * queue the only update that can release the handler behind the handler itself
 * — a deadlock that resolves only when the approval times out.
 */
export function updateConstraint(ctx: Context): string | undefined {
  if (ctx.callbackQuery) return undefined;
  const chatId = ctx.chat?.id;
  return chatId === undefined ? undefined : String(chatId);
}

// -------------------------------------------------------------------- //
//  Tool-call approval: inline-keyboard prompts + callback_query         //
// -------------------------------------------------------------------- //

/**
 * Minimal surface the adapter needs from the approvals stack, narrowed via
 * `Pick` so this file only depends on the two methods it actually calls
 * (Interface Segregation) rather than the full service/repository shape.
 * `ChannelsModule` threads real instances into the adapter factory closure —
 * the same mechanism it already uses to give `ChannelManagerService` a
 * `UserRepository` (see channels.module.ts). Optional because the adapter's
 * own tests construct it with a single argument; a callback received with no
 * deps wired answers with an error instead of throwing.
 */
export interface TelegramApprovalDeps {
  readonly userRepo: Pick<UserRepository, 'findByTelegramId'>;
  readonly toolApprovals: Pick<ToolApprovalService, 'resolve' | 'revoke'>;
}

/** Cap on the in-adapter prompt→message tracking map (FIFO eviction). */
const MAX_TRACKED_PROMPT_MESSAGES = 500;

interface TrackedPromptMessage {
  readonly chatId: string;
  readonly messageId: number;
}

interface ApprovalButton {
  readonly text: string;
  readonly callback_data: string;
}

/** Button labels for the six `ApprovalChoice` values (spec §4 / Task 3). */
const CHOICE_LABELS: Record<ApprovalChoice, string> = {
  allow_once: 'Allow once',
  allow_session: 'Allow (session)',
  allow_always: 'Always allow',
  deny_once: 'Deny once',
  deny_session: 'Deny (session)',
  deny_always: 'Always deny',
};

function isApprovalChoice(value: string): value is ApprovalChoice {
  return Object.prototype.hasOwnProperty.call(CHOICE_LABELS, value);
}

function scopeTierOf(choice: ApprovalChoice): 'once' | 'session' | 'always' {
  if (choice.endsWith('once')) return 'once';
  if (choice.endsWith('session')) return 'session';
  return 'always';
}

function toApprovalButton(choice: ApprovalChoice, approvalId: string): ApprovalButton {
  return { text: CHOICE_LABELS[choice], callback_data: `apr:${approvalId}:${choice}` };
}

/**
 * Honest-buttons rule: render exactly one button per `offeredScopes` entry
 * present in the frame — never a fixed six. Allow/deny buttons for the same
 * scope tier (once/session/always) share a row when both are offered.
 */
function buildApprovalKeyboard(
  offeredScopes: readonly string[] | undefined,
  approvalId: string,
): ApprovalButton[][] {
  const choices = (offeredScopes ?? []).filter(isApprovalChoice);
  const used = new Set<ApprovalChoice>();
  const rows: ApprovalButton[][] = [];

  for (const choice of choices) {
    if (used.has(choice)) continue;
    used.add(choice);
    const tier = scopeTierOf(choice);
    const partner = choices.find((c) => !used.has(c) && scopeTierOf(c) === tier);
    const row: ApprovalButton[] = [toApprovalButton(choice, approvalId)];
    if (partner) {
      used.add(partner);
      row.push(toApprovalButton(partner, approvalId));
    }
    rows.push(row);
  }

  return rows;
}

function formatParamsSummaryLines(paramsSummary?: Record<string, string>): string {
  const entries = Object.entries(paramsSummary ?? {});
  if (entries.length === 0) return '';
  return '\n' + entries.map(([key, value]) => `• ${key}: ${value}`).join('\n');
}

function formatPromptText(payload: ApprovalFramePayload): string {
  const toolName = payload.toolName ?? 'a tool';
  return `\u{1F510} Approval needed: run ${toolName}?${formatParamsSummaryLines(payload.paramsSummary)}`;
}

function formatNoticeText(payload: ApprovalFramePayload): string {
  const toolName = payload.toolName ?? 'a tool';
  const reasonText =
    payload.reason === 'standing_deny'
      ? 'You have a standing deny for this action.'
      : 'You have a session deny for this action.';
  return `\u{1F6AB} Blocked: ${toolName}\n${reasonText}${formatParamsSummaryLines(payload.paramsSummary)}`;
}

function formatResolvedText(payload: ApprovalFramePayload): string {
  const scopeSuffix = payload.scope ? ` (${payload.scope})` : '';
  switch (payload.status) {
    case 'APPROVED':
      return `✅ Approved${scopeSuffix}`;
    case 'DENIED':
      return `❌ Denied${scopeSuffix}`;
    case 'EXPIRED':
      return '⏳ Expired — no response received.';
    case 'CANCELLED':
      return '⏹ Cancelled.';
    default:
      return `Resolved: ${payload.status ?? 'unknown'}`;
  }
}

function formatChoiceOutcomeText(choice: ApprovalChoice, downgraded: boolean): string {
  const isAllow = choice.startsWith('allow');
  const icon = isAllow ? '✅' : '❌';
  const verb = isAllow ? 'Approved' : 'Denied';
  const suffix = downgraded ? ' (adjusted to an available scope)' : '';
  return `${icon} ${verb} (${scopeTierOf(choice)})${suffix}`;
}

type ParsedApprovalCallback =
  | { readonly kind: 'resolve'; readonly approvalId: string; readonly choice: ApprovalChoice }
  | { readonly kind: 'revoke'; readonly approvalId: string };

const CALLBACK_REVOKE_PREFIX = 'aprrevoke:';
const CALLBACK_RESOLVE_PREFIX = 'apr:';

/** Parse `apr:<approvalId>:<choice>` / `aprrevoke:<approvalId>` callback_data. */
function parseApprovalCallbackData(data: string): ParsedApprovalCallback | null {
  if (data.startsWith(CALLBACK_REVOKE_PREFIX)) {
    const approvalId = data.slice(CALLBACK_REVOKE_PREFIX.length);
    return approvalId.length > 0 ? { kind: 'revoke', approvalId } : null;
  }
  if (data.startsWith(CALLBACK_RESOLVE_PREFIX)) {
    const rest = data.slice(CALLBACK_RESOLVE_PREFIX.length);
    const sep = rest.lastIndexOf(':');
    if (sep <= 0) return null;
    const approvalId = rest.slice(0, sep);
    const choiceRaw = rest.slice(sep + 1);
    return isApprovalChoice(choiceRaw) ? { kind: 'resolve', approvalId, choice: choiceRaw } : null;
  }
  return null;
}

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
 *
 * `deps` threads the approvals stack into the adapter — optional so existing
 * single-argument construction (this adapter's own unit tests, and any
 * caller that doesn't need approval callbacks) keeps working unchanged.
 */
export function createTelegramAdapter(
  config: ChannelAdapterConfig,
  deps?: TelegramApprovalDeps,
): ChannelAdapter {
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
  let runnerHandle: RunnerHandle | null = null;

  // Concurrency ordering. Must be installed before any handler below.
  bot.use(sequentialize(updateConstraint));

  // Without an error handler grammY's default rethrows, which tears down the
  // whole runner — one throwing handler would take polling down for every user.
  bot.catch((err) => {
    logger.error(
      { updateId: err.ctx.update.update_id, error: err.message },
      'Unhandled error in Telegram middleware',
    );
  });

  // approvalId -> {chatId, messageId} of the inline-keyboard prompt sent for
  // it, so a later `approval.resolved` frame (which may arrive because the
  // approval was resolved through a *different* channel, e.g. the web
  // dashboard or bell) knows which Telegram message to edit in place. FIFO
  // capped so a long-running bot can't leak memory on abandoned prompts.
  const promptMessages = new Map<string, TrackedPromptMessage>();

  function rememberPromptMessage(approvalId: string, chatId: string, messageId: number): void {
    if (promptMessages.size >= MAX_TRACKED_PROMPT_MESSAGES && !promptMessages.has(approvalId)) {
      const oldestKey = promptMessages.keys().next().value;
      if (oldestKey !== undefined) {
        promptMessages.delete(oldestKey);
      }
    }
    promptMessages.set(approvalId, { chatId, messageId });
  }

  /**
   * Resolve which message to edit when an approval settles via callback.
   * Prefer the tapped message (`ctx.callbackQuery.message`), but Telegram omits
   * it for messages older than 48h — fall back to the tracked prompt so the
   * inline keyboard is still replaced instead of left live. Returns undefined
   * only when neither is available.
   */
  function editTargetFor(
    live: { chat: { id: number }; message_id: number } | undefined,
    approvalId: string,
  ): { chatId: number | string; messageId: number } | undefined {
    if (live) return { chatId: live.chat.id, messageId: live.message_id };
    const tracked = promptMessages.get(approvalId);
    return tracked ? { chatId: tracked.chatId, messageId: tracked.messageId } : undefined;
  }

  async function safeEditMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
  ): Promise<void> {
    try {
      await bot.api.editMessageText(chatId, messageId, text);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('message is not modified')) {
        return;
      }
      logger.warn({ chatId, messageId, error: msg }, 'Failed to edit approval message');
    }
  }

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

  // Handle inline-keyboard taps on approval prompts/notices.
  //
  // Security boundary: the Telegram `from.id` on the callback is resolved to
  // a Clawix user via the SAME telegramId lookup the text handler's user
  // resolution relies on (`UserRepository.findByTelegramId`, via
  // `MessageRouterService.lookupUser` for text messages). A foreign or
  // unmapped Telegram user gets an error answer and `resolve`/`revoke` are
  // never called — the userId passed to the approval service always comes
  // from this lookup, never from the callback_data payload.
  bot.on('callback_query:data', async (ctx) => {
    const callbackQueryId = ctx.callbackQuery.id;
    const data = ctx.callbackQuery.data;
    const parsed = parseApprovalCallbackData(data);

    if (!parsed) {
      logger.warn({ data }, 'Unrecognised approval callback_data');
      await bot.api.answerCallbackQuery(callbackQueryId, {
        text: 'Unrecognised action.',
        show_alert: true,
      });
      return;
    }

    if (!deps) {
      logger.warn(
        { approvalId: parsed.approvalId },
        'Approval callback received but no approvals deps are wired',
      );
      await bot.api.answerCallbackQuery(callbackQueryId, {
        text: 'Approvals are not available right now.',
        show_alert: true,
      });
      return;
    }

    const fromId = ctx.callbackQuery.from.id;
    const user = await deps.userRepo.findByTelegramId(String(fromId));
    if (!user) {
      logger.warn(
        { fromId, approvalId: parsed.approvalId },
        'Approval callback from unmapped Telegram user — refusing',
      );
      await bot.api.answerCallbackQuery(callbackQueryId, {
        text: 'You are not authorized for this action.',
        show_alert: true,
      });
      return;
    }

    const target = ctx.callbackQuery.message;

    if (parsed.kind === 'resolve') {
      const result = await deps.toolApprovals.resolve(parsed.approvalId, user.id, parsed.choice);
      if (!result.ok) {
        await bot.api.answerCallbackQuery(callbackQueryId, {
          text: 'This approval is no longer available.',
          show_alert: true,
        });
        return;
      }
      await bot.api.answerCallbackQuery(callbackQueryId, { text: 'Recorded.' });
      // Edit the prompt (falling back to the tracked message when Telegram
      // omits the tapped one), THEN drop the map entry — deleting before the
      // edit would strip the only fallback for a >48h-old prompt and leave its
      // buttons live. Any later `approval.resolved` frame then no-ops.
      const editTarget = editTargetFor(target, parsed.approvalId);
      if (editTarget) {
        await safeEditMessageText(
          editTarget.chatId,
          editTarget.messageId,
          formatChoiceOutcomeText(parsed.choice, result.downgraded),
        );
      }
      promptMessages.delete(parsed.approvalId);
      return;
    }

    const removed = await deps.toolApprovals.revoke(parsed.approvalId, user.id);
    await bot.api.answerCallbackQuery(callbackQueryId, {
      text: removed ? 'Standing deny revoked.' : 'Nothing to revoke.',
    });
    if (removed) {
      const editTarget = editTargetFor(target, parsed.approvalId);
      if (editTarget) {
        await safeEditMessageText(editTarget.chatId, editTarget.messageId, '\u{1F513} Revoked.');
      }
      promptMessages.delete(parsed.approvalId);
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
        // `run()` (grammY runner) instead of `bot.start()`: the built-in poller
        // handles updates strictly sequentially, so a handler that parks — an
        // agent run awaiting a tool approval — stalls the whole update loop and
        // the approval tap can never arrive. The runner processes updates
        // concurrently; `sequentialize` above restores per-chat ordering.
        //
        // `allowed_updates: []` means "all types except chat_member" — the same
        // default `bot.start()` sent. Passed explicitly because the runner omits
        // the field otherwise, and Telegram then reuses whatever was last set on
        // the token (possibly a narrower list from another deployment).
        runnerHandle = run(bot, { runner: { fetch: { allowed_updates: [] } } });
        logger.info('Telegram bot polling started');
      }
    },

    async disconnect(): Promise<void> {
      logger.info('Stopping Telegram bot');
      if (runnerHandle) {
        // Resolves once in-flight middleware finishes.
        if (runnerHandle.isRunning()) {
          await runnerHandle.stop();
        }
        runnerHandle = null;
        return;
      }
      await bot.stop();
    },

    async sendMessage(message: OutboundMessage): Promise<string | undefined> {
      const chatId = message.recipientId;
      const event = message.metadata?.event;

      // Tool-approval prompt/notice/resolved frames (Task 9 delivery) render
      // as an inline-keyboard card instead of the generic chunked-text path
      // below — `metadata.approval` carries the structured `ApprovalFramePayload`.
      if (event === 'approval.request' || event === 'approval.notice') {
        const payload = message.metadata?.['approval'] as ApprovalFramePayload | undefined;
        if (!payload) return undefined;

        const isPrompt = event === 'approval.request';
        const text = isPrompt ? formatPromptText(payload) : formatNoticeText(payload);
        const keyboard: ApprovalButton[][] = isPrompt
          ? buildApprovalKeyboard(payload.offeredScopes, payload.approvalId)
          : [[{ text: 'Revoke standing deny', callback_data: `aprrevoke:${payload.approvalId}` }]];

        const sent = await bot.api.sendMessage(chatId, text, {
          reply_markup: { inline_keyboard: keyboard },
        });
        if (isPrompt) {
          rememberPromptMessage(payload.approvalId, chatId, sent.message_id);
        }
        return String(sent.message_id);
      }

      if (event === 'approval.resolved') {
        const payload = message.metadata?.['approval'] as ApprovalFramePayload | undefined;
        if (!payload) return undefined;

        const tracked = promptMessages.get(payload.approvalId);
        if (!tracked) return undefined; // no known message to edit — nothing to do

        promptMessages.delete(payload.approvalId);
        await safeEditMessageText(tracked.chatId, tracked.messageId, formatResolvedText(payload));
        return String(tracked.messageId);
      }

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
