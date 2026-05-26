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
  createWikiPageSchema,
  updateWikiPageSchema,
  wikiShareTargetSchema,
  type CreateWikiPageInput,
  type UpdateWikiPageInput,
  type WikiShareTarget,
  type WikiGraph,
} from '@clawix/shared';

import type { JwtPayload } from '../auth/auth.types.js';
import type { WikiScope } from '../generated/prisma/client.js';
import { Roles } from '../auth/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { WikiService, type WikiPageDto } from './wiki.service.js';
import type { LintFinding } from '../engine/wiki/lint.js';

interface AuthenticatedRequest {
  readonly user: JwtPayload;
}

/**
 * Wiki REST surface. Reads are open to every authenticated user
 * (visibility-gated by the service). Writes require developer or admin role.
 *
 * All routes are nested under /memory per the design doc §5.3.
 */
@Controller('memory')
export class WikiController {
  constructor(private readonly svc: WikiService) {}

  /**
   * GET /memory?ownership=&tags=&scope=&q=
   * Lists pages visible to (or owned by) the caller.
   */
  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('ownership') ownership: 'mine' | 'visible' = 'visible',
    @Query('tags') tagsRaw?: string,
    @Query('scope') scope?: WikiScope,
    @Query('q') q?: string,
  ): Promise<WikiPageDto[]> {
    const tags = tagsRaw
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return this.svc.listPages(req.user.sub, {
      ownership: ownership === 'mine' ? 'mine' : 'visible',
      tags,
      scope,
      query: q,
    });
  }

  /**
   * GET /memory/schema
   * Returns the caller's _schema page content (bootstrap-creates it if missing).
   */
  @Get('schema')
  async getSchema(@Req() req: AuthenticatedRequest): Promise<{ content: string }> {
    return this.svc.getSchema(req.user.sub);
  }

  /**
   * PATCH /memory/schema
   * Updates the caller's _schema page content. developer/admin only.
   */
  @Patch('schema')
  @Roles(UserRole.admin, UserRole.developer)
  async updateSchema(
    @Req() req: AuthenticatedRequest,
    @Body() body: { content: string },
  ): Promise<{ ok: true }> {
    await this.svc.updateSchema(req.user.sub, body.content);
    return { ok: true };
  }

  /**
   * POST /memory/lint
   * Runs lint checks on the caller's wiki. developer/admin only.
   */
  @Post('lint')
  @Roles(UserRole.admin, UserRole.developer)
  async lint(
    @Req() req: AuthenticatedRequest,
    @Body() body: { checks?: string[]; maxResults?: number },
  ): Promise<LintFinding[]> {
    return this.svc.runLint(req.user.sub, body.checks as never, body.maxResults);
  }

  /**
   * GET /memory/graph?ownership=visible|mine
   * Returns the visible subgraph for the caller (nodes + edges).
   */
  @Get('graph')
  async graph(
    @Req() req: AuthenticatedRequest,
    @Query('ownership') ownership: 'mine' | 'visible' = 'visible',
  ): Promise<WikiGraph> {
    return this.svc.getGraph(req.user.sub, {
      ownership: ownership === 'mine' ? 'mine' : 'visible',
    });
  }

  /**
   * GET /memory/:id
   * Returns a single page (visibility-gated by service).
   */
  @Get(':id')
  async get(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<WikiPageDto> {
    return this.svc.getPage(req.user.sub, id);
  }

  /**
   * GET /memory/:id/backlinks
   * Returns pages that link to the given page.
   */
  @Get(':id/backlinks')
  async backlinks(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<{ id: string; slug: string; title: string; summary: string }[]> {
    return this.svc.listBacklinks(req.user.sub, id);
  }

  /**
   * POST /memory
   * Creates a new wiki page. developer/admin only.
   */
  @Post()
  @Roles(UserRole.admin, UserRole.developer)
  @HttpCode(201)
  async create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createWikiPageSchema)) body: CreateWikiPageInput,
  ): Promise<WikiPageDto> {
    return this.svc.createPage(req.user.sub, body);
  }

  /**
   * PATCH /memory/:id
   * Updates an existing wiki page. developer/admin only.
   */
  @Patch(':id')
  @Roles(UserRole.admin, UserRole.developer)
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWikiPageSchema)) body: UpdateWikiPageInput,
  ): Promise<WikiPageDto> {
    return this.svc.updatePage(req.user.sub, id, body);
  }

  /**
   * DELETE /memory/:id
   * Deletes a wiki page. developer/admin only. Returns 204.
   */
  @Delete(':id')
  @Roles(UserRole.admin, UserRole.developer)
  @HttpCode(204)
  async remove(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    await this.svc.deletePage(req.user.sub, id);
  }

  /**
   * POST /memory/:id/share
   * Shares a page with a group or the entire org. developer/admin only.
   */
  @Post(':id/share')
  @Roles(UserRole.admin, UserRole.developer)
  async share(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(wikiShareTargetSchema)) body: WikiShareTarget,
  ): Promise<{ shareId: string }> {
    return this.svc.sharePage(req.user.sub, id, body);
  }

  /**
   * DELETE /memory/shares/:shareId
   * Revokes a share. developer/admin only. Returns 204.
   */
  @Delete('shares/:shareId')
  @Roles(UserRole.admin, UserRole.developer)
  @HttpCode(204)
  async revokeShare(
    @Req() req: AuthenticatedRequest,
    @Param('shareId') shareId: string,
  ): Promise<void> {
    await this.svc.revokeShare(req.user.sub, shareId);
  }

  /**
   * DELETE /memory/:id/org-share
   * Revokes the active org share for a page by finding and revoking it server-side.
   * admin/developer only. Returns 204.
   */
  @Delete(':id/org-share')
  @HttpCode(204)
  @Roles(UserRole.admin, UserRole.developer)
  async revokeOrgShare(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    await this.svc.revokeOrgShare(req.user.sub, id);
  }

  /**
   * DELETE /memory/:id/group-share/:groupId
   * Revokes the active group share for (page, group). developer/admin only.
   */
  @Delete(':id/group-share/:groupId')
  @HttpCode(204)
  @Roles(UserRole.admin, UserRole.developer)
  async revokeGroupShare(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('groupId') groupId: string,
  ): Promise<void> {
    await this.svc.revokeGroupShare(req.user.sub, id, groupId);
  }
}
