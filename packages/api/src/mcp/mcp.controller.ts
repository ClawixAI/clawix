import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Redirect,
  Req,
} from '@nestjs/common';
import {
  connectMcpSchema,
  setMcpTiersSchema,
  updateMcpConnectionSchema,
  type ConnectMcpInput,
  type SetMcpTiersInput,
  type UpdateMcpConnectionInput,
} from '@clawix/shared';

import type { JwtPayload } from '../auth/auth.types.js';
import { Public } from '../auth/public.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { McpService } from './mcp.service.js';

interface AuthenticatedRequest {
  readonly user: JwtPayload;
}

/**
 * User-facing MCP REST surface. All routes JWT-guarded by the global guard;
 * policy.allowMcp is enforced inside McpService.
 */
@Controller('mcp')
export class McpController {
  constructor(private readonly svc: McpService) {}

  /** Enabled catalog + the caller's connection status per server. */
  @Get('servers')
  async list(@Req() req: AuthenticatedRequest) {
    return this.svc.listServers(req.user.sub);
  }

  @Post('servers/:id/connect')
  async connect(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    // `.default({})` makes zod substitute {} for an absent/undefined body so a
    // credential-less connect (valid for authType='none' servers) parses
    // instead of failing validation before the handler runs.
    @Body(new ZodValidationPipe(connectMcpSchema.default({}))) body: ConnectMcpInput,
  ) {
    return this.svc.connect(req.user.sub, id, body);
  }

  /** Begin the per-user OAuth flow; returns the provider authorize URL. */
  @Post('servers/:id/oauth/start')
  async oauthStart(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const authorizeUrl = await this.svc.startOAuth(req.user.sub, id);
    return { authorizeUrl };
  }

  /**
   * Public provider redirect target. State is the single-use CSRF guard.
   *
   * Uses Nest's native `@Redirect()` (return `{ url, statusCode }`) rather than
   * a manual `@Res()` write: under the Fastify adapter, setting the status on an
   * injected `@Res()` reply was overridden back to 200 by Nest's response
   * controller. `@Redirect()` goes through the adapter's redirect path and emits
   * a real 302.
   */
  @Public()
  @Get('oauth/callback')
  @Redirect()
  async oauthCallback(
    @Query('state') state: string,
    @Query('code') code: string,
  ): Promise<{ url: string; statusCode: number }> {
    const webBase = process.env['WEB_BASE_URL'] ?? 'http://localhost:3000';
    try {
      const { serverId } = await this.svc.handleOAuthCallback(state, code);
      return { url: `${webBase}/mcp-servers/${serverId}?tab=info&oauth=success`, statusCode: 302 };
    } catch {
      return { url: `${webBase}/mcp-servers?oauth=error`, statusCode: 302 };
    }
  }

  @Patch('connections/:id')
  async updateConnection(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMcpConnectionSchema)) body: UpdateMcpConnectionInput,
  ) {
    return this.svc.updateConnection(req.user.sub, id, body);
  }

  @Delete('connections/:id')
  @HttpCode(204)
  async deleteConnection(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    await this.svc.deleteConnection(req.user.sub, id);
  }

  @Post('connections/:id/refresh')
  async refreshConnection(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.refreshConnection(req.user.sub, id);
  }

  @Get('servers/:id/tools')
  async tools(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.listTools(req.user.sub, id);
  }

  @Get('servers/:id/calls')
  async calls(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.svc.getCalls(req.user.sub, id, cursor);
  }

  /** Stored tier assignment for the caller's connection, or null. */
  @Get('connections/:id/tiers')
  async getTiers(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.getConnectionTiers(req.user.sub, id);
  }

  /** Persist a human-curated tier assignment for the caller's connection. */
  @Put('connections/:id/tiers')
  async setTiers(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setMcpTiersSchema)) body: SetMcpTiersInput,
  ) {
    return this.svc.setTiers(req.user.sub, id, body.tiers);
  }

  /** LLM auto-sort the connection's catalog into tiers (org default provider). */
  @Post('connections/:id/auto-sort-tiers')
  async autoSortTiers(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.autoSortTiers(req.user.sub, id);
  }
}
