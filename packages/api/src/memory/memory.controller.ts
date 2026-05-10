import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  createMemoryItemSchema,
  memoryListQuerySchema,
  updateMemoryItemSchema,
  type CreateMemoryItemInput,
  type MemoryListQuery,
  type UpdateMemoryItemInput,
} from '@clawix/shared';

import type { JwtPayload } from '../auth/auth.types.js';
import type { MemoryItem } from '../generated/prisma/client.js';
import { Roles } from '../auth/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MemoryService } from './memory.service.js';

interface AuthenticatedRequest {
  readonly user: JwtPayload;
}

/**
 * Custom-memory REST surface. Reads are open to every authenticated user
 * (visibility-gated by the service). Writes are admin + developer; viewer
 * is read-only.
 */
@Controller('memory')
export class MemoryController {
  constructor(private readonly service: MemoryService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(memoryListQuerySchema)) query: MemoryListQuery,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ items: readonly MemoryItem[] }> {
    const items = await this.service.list(req.user.sub, query.scope);
    return { items };
  }

  @Get(':id')
  async read(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<MemoryItem> {
    return this.service.read(id, req.user.sub);
  }

  @Post()
  @Roles(UserRole.admin, UserRole.developer)
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(createMemoryItemSchema)) body: CreateMemoryItemInput,
    @Req() req: AuthenticatedRequest,
  ): Promise<MemoryItem> {
    return this.service.create(req.user.sub, req.user.role, body);
  }

  @Patch(':id')
  @Roles(UserRole.admin, UserRole.developer)
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMemoryItemSchema)) body: UpdateMemoryItemInput,
    @Req() req: AuthenticatedRequest,
  ): Promise<MemoryItem> {
    return this.service.update(id, req.user.sub, req.user.role, body);
  }

  @Delete(':id')
  @Roles(UserRole.admin, UserRole.developer)
  @HttpCode(204)
  async delete(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.service.delete(id, req.user.sub);
  }
}
