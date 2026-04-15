import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createAgentDefinitionSchema,
  updateAgentDefinitionSchema,
  paginationSchema,
} from '@clawix/shared';
import type {
  CreateAgentDefinitionInput,
  UpdateAgentDefinitionInput,
  PaginationInput,
} from '@clawix/shared';
import { z } from 'zod';
import { Roles } from '../auth/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AgentsService } from './agents.service.js';

const createUserAgentSchema = z.object({
  userId: z.string().cuid(),
  agentDefinitionId: z.string().cuid(),
});

const createSubAgentSchema = z.object({
  userId: z.string().cuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  systemPrompt: z.string().min(1).max(50000),
  provider: z.string().min(1),
  model: z.string().min(1),
  maxTokensPerRun: z.number().int().positive().optional(),
});

interface AuthRequest {
  user: { sub: string; email: string; role: string };
}

@ApiTags('agents')
@Controller('api/v1/agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  findAll(
    @Query(new ZodValidationPipe(paginationSchema)) query: PaginationInput,
    @Query('role') role?: string,
  ) {
    const validRole = role === 'primary' || role === 'worker' ? role : undefined;
    return this.agentsService.listAgents(query, validRole);
  }

  @Get('providers')
  async getProviders() {
    const configured = await this.agentsService.listConfiguredProviders();
    return { success: true, data: configured };
  }

  // IMPORTANT: literal path routes must come before :id parameter routes
  @Get('user-agents')
  listUserAgents(@Req() req: AuthRequest) {
    const { user } = req;
    return this.agentsService.listUserAgents(user.sub, user.role);
  }

  @Post('user-agents')
  @Roles(UserRole.admin)
  createUserAgent(
    @Body(new ZodValidationPipe(createUserAgentSchema)) body: { userId: string; agentDefinitionId: string },
  ) {
    return this.agentsService.assignUserAgent(body);
  }

  @Patch('user-agents/:id')
  @Roles(UserRole.admin)
  updateUserAgent(
    @Param('id') id: string,
    @Body() body: { agentDefinitionId: string },
  ) {
    return this.agentsService.updateUserAgent(id, body);
  }

  @Delete('user-agents/:id')
  @Roles(UserRole.admin)
  deleteUserAgent(@Param('id') id: string) {
    return this.agentsService.deleteUserAgent(id);
  }

  @Post('sub-agents')
  createSubAgent(
    @Body(new ZodValidationPipe(createSubAgentSchema)) body: {
      userId: string;
      name: string;
      description?: string;
      systemPrompt: string;
      provider: string;
      model: string;
      maxTokensPerRun?: number;
    },
    @Req() req: AuthRequest,
  ) {
    const { user } = req;
    return this.agentsService.createSubAgent(body, user.sub);
  }

  @Get(':id/runs')
  listRuns(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(paginationSchema)) query: PaginationInput,
  ) {
    return this.agentsService.listAgentRuns(id, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.agentsService.getAgent(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createAgentDefinitionSchema)) body: CreateAgentDefinitionInput,
    @Req() req: AuthRequest,
  ) {
    const { user } = req;
    return this.agentsService.createAgent(body, user.sub);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAgentDefinitionSchema)) body: UpdateAgentDefinitionInput,
    @Req() req: AuthRequest,
  ) {
    const { user } = req;
    return this.agentsService.updateAgent(id, body, user.sub, user.role);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthRequest) {
    const { user } = req;
    return this.agentsService.deleteAgent(id, user.sub, user.role);
  }
}
