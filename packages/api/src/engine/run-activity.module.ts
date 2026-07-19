import { Module } from '@nestjs/common';

import { RunActivityRegistry } from './run-activity.registry.js';

/**
 * Owns the single `RunActivityRegistry` instance shared by `EngineModule`
 * (agent-runner / task-executor watchdog) and `ApprovalsModule`
 * (`awaiting_approval:<tool>` activity marker during a rendezvous wait).
 *
 * Split out from `EngineModule` so `ApprovalsModule` can depend on the
 * registry without importing the whole of `EngineModule` — which itself
 * needs to import `ApprovalsModule` for `ToolApprovalService`. Importing
 * `EngineModule` from both sides would form a cycle; importing this
 * single-provider module from both sides does not.
 */
@Module({
  providers: [RunActivityRegistry],
  exports: [RunActivityRegistry],
})
export class RunActivityModule {}
