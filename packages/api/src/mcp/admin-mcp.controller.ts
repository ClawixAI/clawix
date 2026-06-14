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
  importMcpServerSchema,
  updateMcpServerSchema,
  type ImportMcpServerInput,
  type UpdateMcpServerInput,
} from '@clawix/shared';

import type { JwtPayload } from '../auth/auth.types.js';
import { Roles } from '../auth/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { McpService } from './mcp.service.js';

interface AuthenticatedRequest {
  readonly user: JwtPayload;
}

/** Admin-only MCP governance: import + manage the org server catalog. */
@Controller('admin/mcp')
@Roles(UserRole.admin)
export class AdminMcpController {
  constructor(private readonly svc: McpService) {}

  @Post('servers')
  async importServer(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(importMcpServerSchema)) body: ImportMcpServerInput,
  ) {
    return this.svc.importServer(req.user.sub, body);
  }

  @Get('servers')
  async servers() {
    return this.svc.adminListServers();
  }

  @Patch('servers/:id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMcpServerSchema)) body: UpdateMcpServerInput,
  ) {
    return this.svc.updateServer(req.user.sub, id, body);
  }

  @Delete('servers/:id')
  @HttpCode(204)
  async remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    await this.svc.deleteServer(req.user.sub, id);
  }

  @Get('servers/:id/calls')
  async calls(@Param('id') id: string, @Query('cursor') cursor?: string) {
    return this.svc.adminGetCalls(id, cursor);
  }
}
