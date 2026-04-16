import { Injectable } from '@nestjs/common';
import type {
  SessionCommand,
  SessionCommandContext,
  SessionCommandResult,
} from './session-command.js';
import { SessionManagerService } from '../engine/session-manager.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ResetCommand implements SessionCommand {
  readonly name = 'reset';
  readonly description = 'Start a fresh conversation (current session is archived)';

  constructor(
    private readonly sessionManager: SessionManagerService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(ctx: SessionCommandContext): Promise<SessionCommandResult> {
    const messageCount = await this.prisma.sessionMessage.count({
      where: { sessionId: ctx.sessionId },
    });

    if (messageCount === 0) {
      return { text: 'No active conversation to reset.' };
    }

    await this.sessionManager.deactivate(ctx.sessionId);
    return { text: 'Session reset. Your next message will start a fresh conversation.' };
  }
}
