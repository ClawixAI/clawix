import { Module } from '@nestjs/common';

import { DbModule } from '../db/db.module.js';
import { RunActivityModule } from '../engine/run-activity.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ApprovalDeliveryService } from './approval-delivery.service.js';
import { ApprovalsController } from './approvals.controller.js';
import { ToolApprovalsController } from './tool-approvals.controller.js';
import { ToolApprovalService, APPROVAL_DELIVERY } from './tool-approval.service.js';

/**
 * `RunActivityRegistry` is imported from `RunActivityModule` (a tiny module
 * that owns and exports the single registry instance — see
 * `run-activity.module.ts`) rather than provided here, so the
 * `awaiting_approval:<tool>` activity marker recorded during a rendezvous
 * wait is visible to the SAME registry instance the engine watchdog
 * snapshots for its death-log. Providing a second instance here would make
 * that marker invisible to the watchdog — see Task 9 carry-forward from the
 * Task 5 review.
 *
 * We depend on `RunActivityModule` directly rather than the full
 * `EngineModule` because `EngineModule` itself imports `ApprovalsModule`
 * (`AgentRunnerService` needs `ToolApprovalService` — Task 10). Importing
 * `EngineModule` here would form a cycle; `RunActivityModule` is a leaf
 * module with no dependency on either side, so it does not.
 */
@Module({
  imports: [DbModule, RunActivityModule, NotificationsModule],
  controllers: [ApprovalsController, ToolApprovalsController],
  providers: [
    ToolApprovalService,
    { provide: APPROVAL_DELIVERY, useClass: ApprovalDeliveryService },
  ],
  exports: [ToolApprovalService],
})
export class ApprovalsModule {}
