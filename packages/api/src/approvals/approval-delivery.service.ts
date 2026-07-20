import { Injectable } from '@nestjs/common';

import { RedisPubSubService } from '../cache/redis-pubsub.service.js';
import { PUBSUB_CHANNELS } from '../cache/cache.constants.js';
import { NotificationFanoutService } from '../notifications/notifications.fanout.js';
import type { ApprovalChoice } from './approval.types.js';
import type { ApprovalDeliveryPort } from './tool-approval.service.js';

/**
 * Pub/sub payload shape for approval frames. Consumed by `ChannelManagerService`
 * (routes to the session's adapter) and, in later tasks, by Telegram (Task 12)
 * and the web dashboard UI (Task 13).
 */
export interface ApprovalFramePayload {
  readonly kind: 'prompt' | 'notice' | 'resolved';
  readonly sessionId: string | null; // routing handle — ChannelManager resolves adapter + recipient
  readonly userId: string;
  readonly approvalId: string;
  readonly toolName?: string;
  readonly paramsSummary?: Record<string, string>;
  readonly offeredScopes?: readonly string[];
  readonly reason?: string;
  readonly expiresAt?: string; // ISO
  readonly status?: string;
  readonly scope?: string;
}

/**
 * Real `ApprovalDeliveryPort` implementation: publishes a frame on the
 * `approvalFrame` pub/sub channel (picked up by `ChannelManagerService` and
 * routed to the requesting session's channel adapter) and, for prompts and
 * notices, raises a `TOOL_APPROVAL` bell notification via the fanout.
 *
 * `deliverPrompt` throws when `sessionId` is `null` — `ToolApprovalService.gate`
 * treats any throw from `deliverPrompt` as the `no_channel` signal and fails
 * closed (auto-deny). Resolved frames intentionally do NOT raise a bell
 * notification — the user already has the approval card open from the
 * prompt/notice and a resolved-frame bell would just be noise.
 */
@Injectable()
export class ApprovalDeliveryService implements ApprovalDeliveryPort {
  constructor(
    private readonly pubsub: RedisPubSubService,
    private readonly fanout: NotificationFanoutService,
  ) {}

  async deliverPrompt(req: {
    approvalId: string;
    userId: string;
    sessionId: string | null;
    toolName: string;
    paramsSummary: Record<string, string>;
    offeredScopes: readonly ApprovalChoice[];
    reason: string;
    expiresAt: Date;
  }): Promise<void> {
    if (req.sessionId === null) {
      // No delivery channel for this run — the caller (ToolApprovalService.gate)
      // treats this throw as the no_channel signal and fails closed.
      throw new Error('ApprovalDeliveryService.deliverPrompt: sessionId is null (no channel)');
    }

    const payload: ApprovalFramePayload = {
      kind: 'prompt',
      sessionId: req.sessionId,
      userId: req.userId,
      approvalId: req.approvalId,
      toolName: req.toolName,
      paramsSummary: req.paramsSummary,
      offeredScopes: req.offeredScopes,
      reason: req.reason,
      expiresAt: req.expiresAt.toISOString(),
    };
    await this.pubsub.publish(PUBSUB_CHANNELS.approvalFrame, payload);
    await this.fanout.create({
      recipientId: req.userId,
      type: 'TOOL_APPROVAL',
      payload: {
        approvalId: req.approvalId,
        toolName: req.toolName,
        paramsSummary: req.paramsSummary,
        offeredScopes: req.offeredScopes,
        reason: req.reason,
        expiresAt: payload.expiresAt,
      },
    });
  }

  async deliverNotice(req: {
    approvalId: string;
    userId: string;
    sessionId: string | null;
    toolName: string;
    paramsSummary: Record<string, string>;
    reason: 'standing_deny' | 'session_deny';
  }): Promise<void> {
    const payload: ApprovalFramePayload = {
      kind: 'notice',
      sessionId: req.sessionId,
      userId: req.userId,
      approvalId: req.approvalId,
      toolName: req.toolName,
      paramsSummary: req.paramsSummary,
      reason: req.reason,
    };
    await this.pubsub.publish(PUBSUB_CHANNELS.approvalFrame, payload);
    await this.fanout.create({
      recipientId: req.userId,
      type: 'TOOL_APPROVAL',
      payload: {
        approvalId: req.approvalId,
        toolName: req.toolName,
        paramsSummary: req.paramsSummary,
        reason: req.reason,
      },
    });
  }

  async deliverResolved(req: {
    approvalId: string;
    userId: string;
    sessionId: string | null;
    toolName?: string;
    status: string;
    scope?: string;
  }): Promise<void> {
    const payload: ApprovalFramePayload = {
      kind: 'resolved',
      sessionId: req.sessionId,
      userId: req.userId,
      approvalId: req.approvalId,
      status: req.status,
      ...(req.toolName !== undefined ? { toolName: req.toolName } : {}),
      ...(req.scope !== undefined ? { scope: req.scope } : {}),
    };
    await this.pubsub.publish(PUBSUB_CHANNELS.approvalFrame, payload);
    // Intentionally no fanout.create — resolved frames don't raise a bell
    // notification (spec Step 1: only prompt/notice do).
  }
}
