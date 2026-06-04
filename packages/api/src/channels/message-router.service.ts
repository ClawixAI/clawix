import { randomUUID } from 'crypto';

import { Injectable } from '@nestjs/common';
import { createLogger } from '@clawix/shared';
import type { ChannelAdapter, ChannelType, InboundMessage } from '@clawix/shared';

import type { User } from '../generated/prisma/client.js';

import { UserRepository } from '../db/user.repository.js';
import { UserAgentRepository } from '../db/user-agent.repository.js';
import { AgentDefinitionRepository } from '../db/agent-definition.repository.js';
import { ChannelRepository } from '../db/channel.repository.js';
import { AgentRunnerService } from '../engine/agent-runner.service.js';
import { SessionManagerService } from '../engine/session-manager.service.js';
import type { ReasoningEvent } from '../engine/reasoning-loop.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CommandService } from '../commands/command.service.js';

import { resolveToolProgressMode, formatToolBubble, type BubbleState } from '@clawix/shared';

import { classifyError } from '../engine/error-classifier.js';
import type { ErrorCategory } from '../engine/recovery-loop.types.js';
import { agentErrorTotal } from '../engine/recovery-metrics.js';

const ERROR_CODE_BY_CATEGORY: Record<ErrorCategory, string> = {
  network: 'NETWORK_ERROR',
  timeout: 'TIMEOUT',
  overloaded: 'OVERLOADED',
  server_error: 'SERVER_ERROR',
  rate_limit: 'RATE_LIMITED',
  auth: 'AUTH_ERROR',
  billing: 'BILLING_ERROR',
  model_not_found: 'MODEL_UNAVAILABLE',
  provider_policy: 'CONTENT_FILTERED',
  context_overflow: 'CONTEXT_OVERFLOW',
  payload_too_large: 'PAYLOAD_TOO_LARGE',
  bad_request: 'BAD_REQUEST',
  policy: 'POLICY_DENIED',
  loop_aborted: 'LOOP_ABORTED',
  unknown: 'AGENT_ERROR',
};

const logger = createLogger('channels:router');

@Injectable()
export class MessageRouterService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly userAgentRepo: UserAgentRepository,
    private readonly agentRunner: AgentRunnerService,
    private readonly sessionManager: SessionManagerService,
    private readonly prisma: PrismaService,
    private readonly commandService: CommandService,
    private readonly agentDefRepo: AgentDefinitionRepository,
    private readonly channelRepo: ChannelRepository,
  ) {}

  async handleInbound(message: InboundMessage, channel: ChannelAdapter): Promise<void> {
    const { senderId, senderName } = message;
    let text = message.text;

    // Anchor the agent's response back to the user's inbound message so adapters
    // that support threading (Telegram) can reply to it. The adapter decides
    // whether/how to thread per its `reply_to_mode`; adapters without threading
    // ignore this metadata key.
    const replyToMessageId = message.channelMessageId;

    // 1. Look up user by channel-appropriate method
    const user = await this.lookupUser(message.channelType, senderId);

    if (!user?.isActive) {
      logger.warn({ senderId, senderName }, 'Unauthorized channel message');
      await channel.sendMessage({
        recipientId: senderId,
        text: 'You are not authorized to use this bot. Contact your administrator.',
      });
      return;
    }

    // 2. Get user's agent
    const userAgent = await this.userAgentRepo.findByUserId(user.id);

    if (!userAgent) {
      logger.warn({ userId: user.id }, 'No agent configured for user');
      await channel.sendMessage({
        recipientId: senderId,
        text: 'No agent has been configured for your account. Contact your administrator.',
      });
      return;
    }

    // 3. Check for session command (before concurrency check — commands work while agent is running)
    if (this.commandService.isSlashPrefixed(text)) {
      const session = await this.sessionManager.getOrCreate({
        userId: user.id,
        agentDefinitionId: userAgent.agentDefinitionId,
        channelId: channel.id,
      });

      const result = await this.commandService.execute(text, {
        userId: user.id,
        sessionId: session.id,
        channelId: channel.id,
        senderId,
        agentDefinitionId: userAgent.agentDefinitionId,
      });

      // Some commands (e.g. /create-skill) rewrite the input and forward to the agent.
      if (result.forwardToAgent) {
        text = result.forwardToAgent;
        // Fall through to agent execution below
      } else {
        // Thread the optional structured event (e.g. `session.reset`) through
        // `metadata.event` so the web adapter can emit a follow-up frame
        // and the chat client can react without a substring match (#107).
        // Telegram / WhatsApp adapters drop metadata they don't recognise.
        await channel.sendMessage({
          recipientId: senderId,
          text: result.text,
          ...(result.event ? { metadata: { event: result.event } } : {}),
        });
        return;
      }
    }

    // 4. Concurrency check
    const userHasRunning = await this.hasRunningAgentForUser(user.id);

    if (userHasRunning) {
      logger.info({ userId: user.id }, 'User has running agent, rejecting message');
      await channel.sendMessage({
        recipientId: senderId,
        text: "I'm still working on your previous message. Please wait.",
      });
      return;
    }

    // 5. Send typing indicator (no-op if adapter doesn't support it)
    if (channel.sendTyping) {
      await channel.sendTyping(senderId).catch(() => {});
    }

    // 6. Run agent — session creation is delegated to agent-runner so that
    //    pre-execution validation failures (provider blocked, budget exceeded,
    //    inactive agent) don't leave orphan empty sessions in the database.
    let agentProviderName: string | undefined;
    try {
      // Resolve agent + channel settings for streaming. Reads happen inside
      // try/catch so NotFoundError (e.g. dangling agent FK) flows to the
      // user-friendly classifier rather than escaping to Fastify.
      const [agentDef, channelRow] = await Promise.all([
        this.agentDefRepo.findById(userAgent.agentDefinitionId),
        this.channelRepo.findById(channel.id).catch(() => null),
      ]);
      agentProviderName = agentDef.provider;
      const toolProgressMode = resolveToolProgressMode(
        channel.type,
        channelRow?.toolProgressMode ?? null,
      );
      const bubbleState: BubbleState = { lastToolName: null };

      // Edit-status-in-place: consecutive tool bubbles within one reasoning
      // beat are consolidated into a single message that is edited as each
      // tool fires (instead of appending a new bubble per tool). The anchor
      // resets on every assistant_chunk so each tool group opens a fresh
      // status message below the prose. Adapters without `editMessage` (web,
      // whatsapp) transparently fall back to appending a new message.
      let statusMessageId: string | undefined;

      const onEvent = agentDef.streamingEnabled
        ? async (e: ReasoningEvent): Promise<void> => {
            if (e.type === 'assistant_chunk') {
              if (e.content.trim().length === 0) return;
              // Prose is a distinct beat — close the current status group.
              statusMessageId = undefined;
              await channel.sendMessage({
                recipientId: senderId,
                text: e.content,
                metadata: { messageId: randomUUID(), replyToMessageId },
              });
            } else if (e.type === 'tool_started') {
              const bubble = formatToolBubble(
                { name: e.name, args: e.args },
                toolProgressMode,
                bubbleState,
              );
              if (!bubble) return;

              // Edit the open status message in place when we can; otherwise
              // (first bubble of the group, or edit failed/unsupported) send a
              // fresh message and remember its id for subsequent edits.
              if (statusMessageId !== undefined && channel.editMessage) {
                try {
                  await channel.editMessage(senderId, statusMessageId, bubble);
                  return;
                } catch {
                  // Fall through to a fresh send and re-anchor below.
                  statusMessageId = undefined;
                }
              }

              statusMessageId = await channel.sendMessage({
                recipientId: senderId,
                text: bubble,
                metadata: { messageId: randomUUID(), replyToMessageId },
              });
            }
          }
        : undefined;

      const result = await this.agentRunner.run({
        agentDefinitionId: userAgent.agentDefinitionId,
        channelId: channel.id,
        userId: user.id,
        input: text,
        channel: channel.type,
        chatId: senderId,
        userName: senderName,
        replyContext: message.replyCtx,
        ...(onEvent ? { onEvent } : {}),
      });

      // When the runner actually streamed, the user already received every
      // chunk live. Skip the trailing single-message send to avoid duplicating
      // the final answer. Non-streaming runs fall through to today's behavior.
      if (!result.streamingUsed) {
        const responseText = result.output ?? 'Agent completed without output.';
        await channel.sendMessage({
          recipientId: senderId,
          text: responseText,
          metadata: {
            messageId: result.responseMessageId ?? result.agentRunId,
            replyToMessageId,
            ...(result.sessionId ? { sessionId: result.sessionId } : {}),
          },
        });
      }

      // 7. Send typing stop
      if (channel.sendTypingStop) {
        await channel.sendTypingStop(senderId).catch(() => {});
      }
    } catch (error: unknown) {
      const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
      const causeInfo =
        cause instanceof Error
          ? { message: cause.message, code: (cause as { code?: string }).code }
          : undefined;
      const classified = classifyError(error);
      agentErrorTotal.inc({
        category: classified.category,
        provider: agentProviderName ?? 'unknown',
      });
      logger.error(
        { userId: user.id, err: error, cause: causeInfo, category: classified.category },
        'Agent execution failed',
      );

      const errorCode = ERROR_CODE_BY_CATEGORY[classified.category] ?? 'AGENT_ERROR';

      // Prefer a structured error event when the channel supports it (web).
      // Fall back to a plain text message on channels that don't (telegram).
      if (channel.sendError) {
        await channel.sendError(senderId, errorCode, classified.text);
      } else {
        await channel.sendMessage({
          recipientId: senderId,
          text: classified.text,
          metadata: { replyToMessageId },
        });
      }

      // Send typing stop on error too
      if (channel.sendTypingStop) {
        await channel.sendTypingStop(senderId).catch(() => {});
      }
    }
  }

  private async lookupUser(channelType: ChannelType, senderId: string): Promise<User | null> {
    switch (channelType) {
      case 'web':
        return this.userRepo.findById(senderId).catch(() => null);
      case 'telegram':
        return this.userRepo.findByTelegramId(senderId);
      case 'whatsapp':
        return this.userRepo.findByWhatsappJid(senderId);
      default:
        logger.warn({ channelType }, 'No user lookup for channel type');
        return null;
    }
  }

  private async hasRunningAgentForUser(userId: string): Promise<boolean> {
    const count = await this.prisma.agentRun.count({
      where: {
        status: 'running',
        session: { userId },
      },
    });
    return count > 0;
  }
}
