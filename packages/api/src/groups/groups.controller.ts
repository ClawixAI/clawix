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
  createGroupSchema,
  updateGroupSchema,
  inviteToGroupSchema,
  groupInviteListQuerySchema,
  type CreateGroupInput,
  type UpdateGroupInput,
  type InviteToGroupInput,
  type GroupInviteListQuery,
} from '@clawix/shared';

import type { JwtPayload } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { GroupAccessService } from './group-access.service.js';

interface AuthenticatedRequest {
  readonly user: JwtPayload;
}

/**
 * Self-service group management REST surface. Every authenticated user can
 * call these — authorization (owner-only writes, invitee-only accept/reject)
 * is enforced inside `GroupAccessService`.
 */
@Controller('groups')
export class GroupsController {
  constructor(private readonly service: GroupAccessService) {}

  @Get('mine')
  async listMine(@Req() req: AuthenticatedRequest) {
    const memberships = await this.service.listMyGroups(req.user.sub);
    return { items: memberships };
  }

  @Get('user-search')
  async searchUsers(
    @Query('q') q: string | undefined,
    @Query('groupId') groupId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const items = await this.service.searchUsersForInvite(req.user.sub, q ?? '', groupId);
    return { items };
  }

  @Get('invites')
  async listInvites(
    @Query(new ZodValidationPipe(groupInviteListQuerySchema)) query: GroupInviteListQuery,
    @Req() req: AuthenticatedRequest,
  ) {
    const items =
      query.scope === 'sent'
        ? await this.service.listInvitesSentByUser(req.user.sub)
        : await this.service.listMyPendingInvites(req.user.sub);
    return { items };
  }

  // Literal route — must come before the dynamic ":id" handlers below
  // so that "deleted" doesn't match the param.
  @Get('deleted')
  async listDeleted(@Req() req: AuthenticatedRequest) {
    return this.service.listDeletedGroups(req.user.role);
  }

  @Post(':id/restore')
  async restore(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.service.restoreGroup(id, req.user.sub, req.user.role);
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(createGroupSchema)) body: CreateGroupInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.createGroup(req.user.sub, body);
  }

  @Get(':id')
  async read(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.service.readGroup(id, req.user.sub);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateGroupSchema)) body: UpdateGroupInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.updateGroup(id, req.user.sub, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.service.deleteGroup(id, req.user.sub);
  }

  @Post(':id/invites')
  @HttpCode(201)
  async invite(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(inviteToGroupSchema)) body: InviteToGroupInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.invite(id, req.user.sub, {
      inviteeId: body.inviteeId,
      email: body.email,
    });
  }

  @Post('invites/:inviteId/accept')
  @HttpCode(204)
  async acceptInvite(
    @Param('inviteId') inviteId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.acceptInvite(inviteId, req.user.sub);
  }

  @Post('invites/:inviteId/reject')
  @HttpCode(204)
  async rejectInvite(
    @Param('inviteId') inviteId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.rejectInvite(inviteId, req.user.sub);
  }

  @Delete('invites/:inviteId')
  @HttpCode(204)
  async revokeInvite(
    @Param('inviteId') inviteId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.revokeInvite(inviteId, req.user.sub);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  async removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.removeMember(id, req.user.sub, userId);
  }

  @Post(':id/leave')
  @HttpCode(204)
  async leave(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.service.leaveGroup(id, req.user.sub);
  }
}
