import { Controller, Get, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Prisma } from '../generated/prisma/client.js';
import { SessionRepository } from '../db/session.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { JwtPayload } from '../auth/auth.types.js';

@ApiTags('chat')
@Controller('api/v1/chat')
export class ChatController {
  constructor(
    private readonly sessionRepo: SessionRepository,
    private readonly prisma: PrismaService,
  ) {}

  @Get('channel')
  async getWebChannel() {
    const channel = await this.prisma.channel.findFirst({
      where: { type: 'web', isActive: true },
      select: { id: true, type: true, isActive: true },
    });
    return { success: true, data: channel };
  }

  @Get('sessions')
  async listSessions(
    @Req() req: { user: JwtPayload },
    @Query() query: { page?: number; limit?: number; channelId?: string; includeArchived?: string },
  ) {
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 20, 100);
    const includeArchived = query.includeArchived === 'true';

    const result = await this.sessionRepo.findByUserId(
      req.user.sub,
      { page, limit },
      query.channelId,
      includeArchived,
    );

    return {
      success: true,
      data: result.data,
      meta: { total: result.meta.total, page, limit },
    };
  }

  @Get('agent-runs')
  async listAgentRuns(@Req() req: { user: JwtPayload }, @Query() query: { limit?: number }) {
    const limit = Math.min(Number(query.limit) || 20, 100);

    const runs = await this.prisma.agentRun.findMany({
      where: {
        session: { userId: req.user.sub },
      },
      orderBy: { startedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        status: true,
        input: true,
        output: true,
        error: true,
        tokenUsage: true,
        startedAt: true,
        completedAt: true,
        parentAgentRunId: true,
        agentDefinition: {
          select: { id: true, name: true, role: true },
        },
      },
    });

    return { success: true, data: runs };
  }

  @Get('agent-runs/:id')
  async getAgentRun(@Req() req: { user: JwtPayload }, @Param('id') runId: string) {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        status: true,
        input: true,
        output: true,
        error: true,
        tokenUsage: true,
        startedAt: true,
        completedAt: true,
        parentAgentRunId: true,
        sessionId: true,
        agentDefinition: {
          select: { id: true, name: true, role: true },
        },
        session: {
          select: { userId: true },
        },
      },
    });

    if (run?.session.userId !== req.user.sub) {
      throw new NotFoundException('Agent run not found');
    }

    // Fetch session messages with tool calls for this run's time range
    const messages = await this.prisma.sessionMessage.findMany({
      where: {
        sessionId: run.sessionId,
        createdAt: {
          gte: run.startedAt,
          ...(run.completedAt ? { lte: run.completedAt } : {}),
        },
        toolCalls: { not: Prisma.JsonNull },
      },
      orderBy: { ordering: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        toolCalls: true,
        toolCallId: true,
        createdAt: true,
      },
    });

    return {
      success: true,
      data: {
        ...run,
        toolCallMessages: messages,
      },
    };
  }

  @Post('agent-runs/stop')
  async stopRunningAgentRuns(@Req() req: { user: JwtPayload }) {
    const result = await this.prisma.agentRun.updateMany({
      where: {
        status: 'running',
        session: { userId: req.user.sub },
      },
      data: {
        status: 'failed',
        error: 'Stopped by user',
        completedAt: new Date(),
      },
    });
    return { success: true, stopped: result.count };
  }

  @Post('sessions/:id/deactivate')
  async deactivateSession(@Req() req: { user: JwtPayload }, @Param('id') sessionId: string) {
    const session = await this.sessionRepo.findById(sessionId);
    if (session.userId !== req.user.sub) {
      throw new NotFoundException('Session not found');
    }
    await this.sessionRepo.update(sessionId, { isActive: false });
    return { success: true };
  }

  @Get('sessions/:id/messages')
  async listMessages(
    @Req() req: { user: JwtPayload },
    @Param('id') sessionId: string,
    @Query() query: { page?: number; limit?: number },
  ) {
    const session = await this.sessionRepo.findById(sessionId);
    if (session.userId !== req.user.sub) {
      throw new NotFoundException('Session not found');
    }

    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 50, 100);
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.sessionMessage.findMany({
        where: { sessionId, archivedAt: null },
        orderBy: { ordering: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.sessionMessage.count({ where: { sessionId, archivedAt: null } }),
    ]);

    return {
      success: true,
      data: data.reverse(), // Return in chronological order (oldest first)
      meta: { total, page, limit },
    };
  }
}
