import { Injectable } from '@nestjs/common';
import { createLogger } from '@clawix/shared';
import type { ChannelAdapter, ChannelType, InboundMessage } from '@clawix/shared';

import type { User } from '../generated/prisma/client.js';

import { UserRepository } from '../db/user.repository.js';
import { UserAgentRepository } from '../db/user-agent.repository.js';
import { AgentRunnerService } from '../engine/agent-runner.service.js';
import { SessionManagerService } from '../engine/session-manager.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CommandService } from '../commands/command.service.js';

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
  ) {}

  async handleInbound(message: InboundMessage, channel: ChannelAdapter): Promise<void> {
    const { senderId, senderName } = message;
    let text = message.text;

    // 1. Look up user by channel-appropriate method
    const user = await this.lookupUser(message.channelType, senderId);

    if (!user || !user.isActive) {
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
        await channel.sendMessage({ recipientId: senderId, text: result.text });
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

    // 5. Get or create session
    const session = await this.sessionManager.getOrCreate({
      userId: user.id,
      agentDefinitionId: userAgent.agentDefinitionId,
      channelId: channel.id,
    });

    // 6. Send typing indicator (no-op if adapter doesn't support it)
    if (channel.sendTyping) {
      await channel.sendTyping(senderId).catch(() => {});
    }

    // 7. Run agent
    try {
      const result = await this.agentRunner.run({
        agentDefinitionId: userAgent.agentDefinitionId,
        sessionId: session.id,
        userId: user.id,
        input: text,
        channel: channel.type,
        chatId: senderId,
        userName: senderName,
      });

      const responseText = result.output ?? 'Agent completed without output.';

      // 8. Send response with metadata for WebSocket delivery
      await channel.sendMessage({
        recipientId: senderId,
        text: responseText,
        metadata: {
          messageId: result.responseMessageId ?? result.agentRunId,
          sessionId: session.id,
        },
      });

      // 9. Send typing stop
      if (channel.sendTypingStop) {
        await channel.sendTypingStop(senderId).catch(() => {});
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ userId: user.id, error: errorMessage }, 'Agent execution failed');

      await channel.sendMessage({
        recipientId: senderId,
        text: 'Something went wrong while processing your message. Please try again.',
      });

      // Send typing stop on error too
      if (channel.sendTypingStop) {
        await channel.sendTypingStop(senderId).catch(() => {});
      }
    }
  }

  private async lookupUser(
    channelType: ChannelType,
    senderId: string,
  ): Promise<User | null> {
    switch (channelType) {
      case 'web':
        return this.userRepo.findById(senderId).catch(() => null);
      case 'telegram':
        return this.userRepo.findByTelegramId(senderId);
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
