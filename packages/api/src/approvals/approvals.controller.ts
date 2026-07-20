import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { z } from 'zod';

import type { JwtPayload } from '../auth/auth.types.js';
import type { ApprovalRequest } from '../generated/prisma/client.js';
import { ToolApprovalService } from './tool-approval.service.js';

interface AuthenticatedRequest {
  readonly user: JwtPayload;
}

/**
 * The six `ApprovalChoice` values (spec §4) — kept in lockstep with the
 * domain union in `approval.types.ts`. Unknown values are rejected with 400.
 */
const approvalChoiceSchema = z.enum([
  'allow_once',
  'allow_session',
  'allow_always',
  'deny_once',
  'deny_session',
  'deny_always',
]);

const resolveBodySchema = z.object({
  choice: approvalChoiceSchema,
});

/**
 * REST surface for the human-in-the-loop tool approval flow: list a user's
 * pending prompts (for reconnect/refresh) and resolve/revoke by id. Ownership
 * is enforced inside `ToolApprovalService` (rendezvous keyed by userId) —
 * mismatches surface as 404, never 403, to avoid an existence leak.
 */
@Controller('api/v1/chat/approvals')
export class ApprovalsController {
  constructor(private readonly toolApprovals: ToolApprovalService) {}

  @Get('pending')
  async listPending(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ success: true; data: ApprovalRequest[] }> {
    const data = await this.toolApprovals.listPending(req.user.sub);
    return { success: true, data };
  }

  @Post(':id/resolve')
  async resolve(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ success: true; data: { downgraded: boolean } }> {
    const parsed = resolveBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Invalid approval choice');
    }

    const result = await this.toolApprovals.resolve(id, req.user.sub, parsed.data.choice);
    if (!result.ok) {
      throw new NotFoundException('Approval request not found');
    }
    return { success: true, data: { downgraded: result.downgraded } };
  }

  @Post(':id/revoke')
  async revoke(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ success: true }> {
    const removed = await this.toolApprovals.revoke(id, req.user.sub);
    if (!removed) {
      throw new NotFoundException('Approval request not found');
    }
    return { success: true };
  }
}
