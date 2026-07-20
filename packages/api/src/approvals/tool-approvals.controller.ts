import { Controller, Delete, Get, NotFoundException, Param, Req } from '@nestjs/common';

import type { JwtPayload } from '../auth/auth.types.js';
import type { UserToolApproval } from '../generated/prisma/client.js';
import { AuditLogRepository } from '../db/audit-log.repository.js';
import { UserToolApprovalRepository } from '../db/user-tool-approval.repository.js';

interface AuthenticatedRequest {
  readonly user: JwtPayload;
}

/**
 * Settings-page surface for a user's standing (`allow_always` /
 * `deny_always`) tool approvals: list and revoke by row id. Ownership is
 * enforced inside `UserToolApprovalRepository.deleteById` (a userId-guarded
 * `deleteMany`) — a mismatch returns 404, never 403, to avoid an existence
 * leak.
 */
@Controller('api/v1/tool-approvals')
export class ToolApprovalsController {
  constructor(
    private readonly userToolApprovals: UserToolApprovalRepository,
    private readonly auditLogs: AuditLogRepository,
  ) {}

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ success: true; data: UserToolApproval[] }> {
    const data = await this.userToolApprovals.listForUser(req.user.sub);
    return { success: true, data };
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ success: true }> {
    const removed = await this.userToolApprovals.deleteById(id, req.user.sub);
    if (!removed) {
      throw new NotFoundException('Tool approval not found');
    }
    await this.auditLogs.create({
      userId: req.user.sub,
      action: 'approval.revoke',
      resource: 'user_tool_approval',
      resourceId: id,
      details: { source: 'settings' },
    });
    return { success: true };
  }
}
