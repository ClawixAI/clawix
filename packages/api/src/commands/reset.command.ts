import { Injectable } from '@nestjs/common';
import type {
  SessionCommand,
  SessionCommandContext,
  SessionCommandResult,
} from './session-command.js';
import { SessionManagerService } from '../engine/session-manager.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ToolApprovalService } from '../approvals/tool-approval.service.js';

@Injectable()
export class ResetCommand implements SessionCommand {
  readonly name = 'reset';
  readonly description = 'Start a fresh conversation (current session is archived)';

  constructor(
    private readonly sessionManager: SessionManagerService,
    private readonly prisma: PrismaService,
    private readonly toolApprovalService: ToolApprovalService,
  ) {}

  async execute(ctx: SessionCommandContext): Promise<SessionCommandResult> {
    const messageCount = await this.prisma.sessionMessage.count({
      where: { sessionId: ctx.sessionId },
    });

    if (messageCount === 0) {
      return { text: 'No active conversation to reset.' };
    }

    await this.sessionManager.deactivate(ctx.sessionId);
    // Session-scoped approval memory ("allow for this session") must not
    // leak into the fresh conversation that follows a reset (spec §4).
    this.toolApprovalService.clearSessionMemory(ctx.sessionId);
    return {
      text: 'Session reset. Your next message will start a fresh conversation.',
      event: 'session.reset',
    };
  }
}
