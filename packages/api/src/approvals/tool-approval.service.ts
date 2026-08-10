import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';

import { createLogger } from '@clawix/shared';

import { UserToolApprovalRepository } from '../db/user-tool-approval.repository.js';
import { ApprovalRequestRepository } from '../db/approval-request.repository.js';
import { AuditLogRepository } from '../db/audit-log.repository.js';
import { RunActivityRegistry } from '../engine/run-activity.registry.js';
import type { ApprovalRequest, Prisma } from '../generated/prisma/client.js';
import {
  memoryKey,
  offeredScopes,
  downgradeChoice,
  type ApprovalChoice,
  type ApprovalScopeKind,
  type LookupResult,
  type MemoryDecision,
} from './approval.types.js';
import { redactParamsSummary } from './params-summary.js';
import { toolApprovalsTotal } from './approval-metrics.js';

const logger = createLogger('approvals:tool-approval');

const SESSION_ENTRY_TTL_MS = 24 * 60 * 60 * 1000; // spec §4: 24h sliding
const TIMEOUT_MS = Number(process.env['TOOL_APPROVAL_TIMEOUT_MS'] ?? 300_000);

const BLOCKED_BASE = (tool: string): string =>
  `BLOCKED: the user denied ${tool}. Do not retry, rephrase, or attempt the same outcome another way.`;
const BLOCKED_STANDING = (tool: string): string =>
  `${BLOCKED_BASE(tool)} The user has a standing denial for this action; they can lift it from the approval card or Settings.`;
const BLOCKED_SUBAGENT = (tool: string): string =>
  `BLOCKED: ${tool} requires user approval, which sub-agents cannot request. Ask for approval from the primary conversation or have the parent perform this step.`;
const BLOCKED_TIMEOUT = (tool: string): string =>
  `BLOCKED: the approval request for ${tool} timed out without a user response. Silence is not consent. Do not retry, rephrase, or attempt the same outcome another way.`;
const BLOCKED_NO_CHANNEL = (tool: string): string =>
  `BLOCKED: ${tool} requires user approval and no delivery channel is available for this session. Do not retry.`;

/**
 * Delivery side channel for approval prompts/notices/resolutions — bell +
 * channel frames. Throws from `deliverPrompt` are treated as no_channel
 * (fail-closed). Real implementation lands in Task 9.
 */
export interface ApprovalDeliveryPort {
  /** Push a prompt/notice frame + bell notification. Throws → treated as no_channel. */
  deliverPrompt(req: {
    approvalId: string;
    userId: string;
    sessionId: string | null;
    toolName: string;
    paramsSummary: Record<string, string>;
    offeredScopes: readonly ApprovalChoice[];
    reason: string;
    expiresAt: Date;
    /** Tool-authored caveats surfaced in the prompt UI; absent = none. */
    warnings?: readonly string[];
  }): Promise<void>;
  deliverNotice(req: {
    approvalId: string;
    userId: string;
    sessionId: string | null;
    toolName: string;
    paramsSummary: Record<string, string>;
    reason: 'standing_deny' | 'session_deny';
  }): Promise<void>;
  deliverResolved(req: {
    approvalId: string;
    userId: string;
    sessionId: string | null;
    toolName?: string;
    status: string;
    scope?: string;
  }): Promise<void>;
}
export const APPROVAL_DELIVERY = Symbol('APPROVAL_DELIVERY');

export interface GateInput {
  readonly userId: string;
  readonly agentRunId: string;
  readonly sessionId: string | null;
  readonly isSubAgent: boolean;
  readonly toolName: string;
  readonly scopeKind: ApprovalScopeKind;
  readonly resourceKey: string; // '' unless resource-scoped
  readonly extractorFailed: boolean;
  readonly params: Readonly<Record<string, unknown>>;
  /**
   * Tool-authored caveats surfaced in the approval prompt (see
   * `Tool.approvalWarningsForParams`). Absent or empty = no banner. Forwarded
   * verbatim to `deliverPrompt`; never gates or blocks the call.
   */
  readonly warnings?: readonly string[];
  readonly abortSignal?: AbortSignal;
}
export type GateResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly blockedMessage: string };

interface SessionEntry {
  readonly decision: MemoryDecision;
  touchedAt: number;
}

interface PendingEntry {
  readonly resolve: (outcome: { choice: ApprovalChoice } | { system: string }) => void;
  readonly input: GateInput;
  readonly offered: readonly ApprovalChoice[];
}

@Injectable()
export class ToolApprovalService implements OnModuleInit {
  /** sessionId → (memoryKey → entry). In-process by design (spec §4). */
  private readonly sessionMemory = new Map<string, Map<string, SessionEntry>>();

  /** approvalId → in-flight rendezvous waiting on a human resolution. */
  private readonly pending = new Map<string, PendingEntry>();

  constructor(
    private readonly userToolApprovals: UserToolApprovalRepository,
    private readonly approvalRequests: ApprovalRequestRepository,
    private readonly auditLogs: AuditLogRepository,
    @Inject(APPROVAL_DELIVERY) private readonly delivery: ApprovalDeliveryPort,
    private readonly runActivity: RunActivityRegistry,
  ) {}

  async onModuleInit(): Promise<void> {
    const swept = await this.approvalRequests.expireAllPending('restart_sweep');
    if (swept > 0) {
      logger.warn({ swept }, 'Expired stale PENDING approvals from before restart');
      await this.auditLogs.create({
        userId: 'system',
        action: 'approval.autodeny',
        resource: 'approval_request',
        resourceId: 'sweep',
        details: { reason: 'restart_sweep', count: swept },
      });
    }
  }

  writeSessionMemory(
    sessionId: string,
    toolName: string,
    resourceKey: string,
    decision: MemoryDecision,
  ): void {
    const bucket = this.sessionMemory.get(sessionId) ?? new Map<string, SessionEntry>();
    bucket.set(memoryKey(toolName, resourceKey), { decision, touchedAt: Date.now() });
    this.sessionMemory.set(sessionId, bucket);
  }

  removeSessionEntry(sessionId: string, key: string): boolean {
    return this.sessionMemory.get(sessionId)?.delete(key) ?? false;
  }

  clearSessionMemory(sessionId: string): void {
    this.sessionMemory.delete(sessionId);
  }

  private readSession(sessionId: string | null, key: string): MemoryDecision | undefined {
    if (!sessionId) return undefined;
    const entry = this.sessionMemory.get(sessionId)?.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.touchedAt > SESSION_ENTRY_TTL_MS) {
      this.sessionMemory.get(sessionId)?.delete(key);
      return undefined;
    }
    // Immutable update: create new entry with refreshed touchedAt
    this.sessionMemory.get(sessionId)?.set(key, { ...entry, touchedAt: Date.now() });
    return entry.decision;
  }

  /**
   * Precedence (spec §5): (a) more-specific key beats less-specific,
   * regardless of decision or store; (b) at equal specificity, deny beats
   * allow, regardless of store. Fail-closed.
   */
  async lookup(input: {
    userId: string;
    sessionId: string | null;
    toolName: string;
    resourceKey: string;
    extractorFailed: boolean;
  }): Promise<LookupResult> {
    const { userId, sessionId, toolName, resourceKey, extractorFailed } = input;
    if (extractorFailed) return { kind: 'prompt', reason: 'extractor_error' };

    const specificities = resourceKey !== '' ? [resourceKey, ''] : [''];
    const persistentRows = await this.userToolApprovals.findForKeys(
      userId,
      toolName,
      specificities,
    );

    for (const level of specificities) {
      const key = memoryKey(toolName, level);
      const session = this.readSession(sessionId, key);
      const persistent = persistentRows.find((r) => r.resourceKey === level);

      const denyStore =
        session === 'deny' ? 'session' : persistent?.decision === 'denied' ? 'persistent' : null;
      if (denyStore) {
        return {
          kind: 'deny',
          hit: {
            decision: 'deny',
            store: denyStore,
            key,
            scope: denyStore === 'session' ? 'session' : 'always',
          },
        };
      }

      const allowStore =
        session === 'allow' ? 'session' : persistent?.decision === 'allowed' ? 'persistent' : null;
      if (allowStore) {
        return {
          kind: 'allow',
          hit: {
            decision: 'allow',
            store: allowStore,
            key,
            scope: allowStore === 'session' ? 'session' : 'always',
          },
        };
      }
    }

    return { kind: 'prompt', reason: 'no_memory' };
  }

  async gate(input: GateInput): Promise<GateResult> {
    const key = memoryKey(input.toolName, input.resourceKey);
    const lookup = await this.lookup(input);

    if (lookup.kind === 'allow') return { allowed: true };

    if (lookup.kind === 'deny') {
      // Pre-resolved row + notice card; NO rendezvous (spec Q3/§6).
      const reason = lookup.hit.store === 'persistent' ? 'standing_deny' : 'session_deny';
      const row = await this.approvalRequests.create({
        userId: input.userId,
        agentRunId: input.agentRunId,
        sessionId: input.sessionId,
        toolName: input.toolName,
        paramsSummary: redactParamsSummary(input.params),
        status: 'DENIED',
        scope: lookup.hit.scope,
        resolutionReason: reason,
        memoryStore: lookup.hit.store,
        memoryKey: lookup.hit.key,
        resolvedAt: new Date(),
      });
      toolApprovalsTotal.inc({ outcome: 'autodeny_standing' });
      await this.audit(input.userId, 'approval.autodeny', row.id, {
        reason,
        tool: input.toolName,
      });
      await this.safeDeliver(() =>
        this.delivery.deliverNotice({
          approvalId: row.id,
          userId: input.userId,
          sessionId: input.sessionId,
          toolName: input.toolName,
          paramsSummary: redactParamsSummary(input.params),
          reason,
        }),
      );
      return { allowed: false, blockedMessage: BLOCKED_STANDING(input.toolName) };
    }

    // prompt path
    if (input.isSubAgent) {
      return this.autoDeny(
        input,
        'subagent',
        BLOCKED_SUBAGENT(input.toolName),
        'autodeny_subagent',
      );
    }
    if (!input.sessionId) {
      return this.autoDeny(
        input,
        'no_channel',
        BLOCKED_NO_CHANNEL(input.toolName),
        'autodeny_no_channel',
      );
    }

    const offered = offeredScopes(input.scopeKind, input.extractorFailed);
    const summary = redactParamsSummary(input.params);
    const expiresAt = new Date(Date.now() + TIMEOUT_MS);
    const row = await this.approvalRequests.create({
      userId: input.userId,
      agentRunId: input.agentRunId,
      sessionId: input.sessionId,
      toolName: input.toolName,
      paramsSummary: summary,
    });
    await this.audit(input.userId, 'approval.request', row.id, {
      tool: input.toolName,
      reason: lookup.reason,
    });

    try {
      await this.delivery.deliverPrompt({
        approvalId: row.id,
        userId: input.userId,
        sessionId: input.sessionId,
        toolName: input.toolName,
        paramsSummary: summary,
        offeredScopes: offered,
        reason: lookup.reason,
        expiresAt,
        ...(input.warnings && input.warnings.length > 0 ? { warnings: input.warnings } : {}),
      });
    } catch (err: unknown) {
      logger.warn({ err, approvalId: row.id }, 'Prompt delivery failed — fail-closed');
      await this.approvalRequests.transitionStatus(row.id, 'PENDING', {
        status: 'DENIED',
        resolutionReason: 'no_channel',
      });
      toolApprovalsTotal.inc({ outcome: 'autodeny_no_channel' });
      await this.audit(input.userId, 'approval.autodeny', row.id, { reason: 'no_channel' });
      return { allowed: false, blockedMessage: BLOCKED_NO_CHANNEL(input.toolName) };
    }

    // Rendezvous: keep hang-tracing honest during the wait (spec §6 step 4).
    this.runActivity.recordToolStart(input.agentRunId, `awaiting_approval:${input.toolName}`);
    try {
      const outcome = await this.waitForResolution(row.id, input, offered);
      return await this.settle(row.id, input, key, outcome);
    } finally {
      this.runActivity.recordToolEnd(input.agentRunId);
    }
  }

  private waitForResolution(
    approvalId: string,
    input: GateInput,
    offered: readonly ApprovalChoice[],
  ): Promise<{ choice: ApprovalChoice } | { system: 'timeout' | 'run_aborted' }> {
    return new Promise((resolvePromise) => {
      let done = false;

      // Short-circuit: if signal already aborted, settle immediately
      if (input.abortSignal?.aborted) {
        done = true;
        this.pending.delete(approvalId);
        resolvePromise({ system: 'run_aborted' });
        return;
      }

      const finish = (
        outcome: { choice: ApprovalChoice } | { system: 'timeout' | 'run_aborted' },
      ) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        input.abortSignal?.removeEventListener('abort', onAbort);
        this.pending.delete(approvalId);
        resolvePromise(outcome);
      };

      const timer = setTimeout(() => finish({ system: 'timeout' }), TIMEOUT_MS);
      timer.unref?.();
      const onAbort = () => finish({ system: 'run_aborted' });
      input.abortSignal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(approvalId, {
        resolve: finish as PendingEntry['resolve'],
        input,
        offered,
      });
    });
  }

  private async settle(
    approvalId: string,
    input: GateInput,
    key: string,
    outcome: { choice: ApprovalChoice } | { system: string },
  ): Promise<GateResult> {
    if ('system' in outcome) {
      const isTimeout = outcome.system === 'timeout';
      await this.approvalRequests.transitionStatus(approvalId, 'PENDING', {
        status: isTimeout ? 'EXPIRED' : 'CANCELLED',
        resolutionReason: outcome.system,
      });
      toolApprovalsTotal.inc({ outcome: isTimeout ? 'expired' : 'cancelled' });
      await this.audit(input.userId, 'approval.autodeny', approvalId, { reason: outcome.system });
      await this.safeDeliver(() =>
        this.delivery.deliverResolved({
          approvalId,
          userId: input.userId,
          sessionId: input.sessionId,
          toolName: input.toolName,
          status: isTimeout ? 'EXPIRED' : 'CANCELLED',
        }),
      );
      return {
        allowed: false,
        blockedMessage: isTimeout ? BLOCKED_TIMEOUT(input.toolName) : BLOCKED_BASE(input.toolName),
      };
    }

    const choice = outcome.choice;
    const isAllow = choice.startsWith('allow');
    const scope = choice.endsWith('once')
      ? 'once'
      : choice.endsWith('session')
        ? 'session'
        : 'always';
    let memoryStore: string | undefined;
    let memKey: string | undefined;

    if (scope === 'session' && input.sessionId) {
      this.writeSessionMemory(
        input.sessionId,
        input.toolName,
        input.resourceKey,
        isAllow ? 'allow' : 'deny',
      );
      memoryStore = 'session';
      memKey = key;
    } else if (scope === 'always') {
      await this.userToolApprovals.upsert({
        userId: input.userId,
        toolName: input.toolName,
        resourceKey: input.resourceKey,
        decision: isAllow ? 'allowed' : 'denied',
      });
      memoryStore = 'persistent';
      memKey = key;
    }

    await this.approvalRequests.transitionStatus(approvalId, 'PENDING', {
      status: isAllow ? 'APPROVED' : 'DENIED',
      scope,
      ...(memoryStore ? { memoryStore, memoryKey: memKey } : {}),
    });
    toolApprovalsTotal.inc({ outcome: isAllow ? 'approved' : 'denied' });
    await this.safeDeliver(() =>
      this.delivery.deliverResolved({
        approvalId,
        userId: input.userId,
        sessionId: input.sessionId,
        toolName: input.toolName,
        status: isAllow ? 'APPROVED' : 'DENIED',
        scope,
      }),
    );
    return isAllow
      ? { allowed: true }
      : { allowed: false, blockedMessage: BLOCKED_BASE(input.toolName) };
  }

  async resolve(
    approvalId: string,
    userId: string,
    requestedChoice: ApprovalChoice,
  ): Promise<{ ok: boolean; downgraded: boolean }> {
    const entry = this.pending.get(approvalId);
    if (!entry || entry.input.userId !== userId) return { ok: false, downgraded: false };
    const { choice, downgraded } = downgradeChoice(requestedChoice, entry.offered);
    await this.audit(userId, 'approval.resolve', approvalId, {
      choice,
      requestedChoice,
      downgraded,
    });
    entry.resolve({ choice });
    return { ok: true, downgraded };
  }

  async revoke(approvalId: string, userId: string): Promise<boolean> {
    const row = await this.approvalRequests.findById(approvalId);
    if (!row || row.userId !== userId || !row.memoryStore || !row.memoryKey) return false;
    // memoryKey format `${toolName}:${resourceKey}` — resourceKey may contain ':'
    const sep = row.memoryKey.indexOf(':');
    const toolName = row.memoryKey.slice(0, sep);
    const resourceKey = row.memoryKey.slice(sep + 1);
    const removed =
      row.memoryStore === 'persistent'
        ? await this.userToolApprovals.deleteByKey(userId, toolName, resourceKey)
        : row.sessionId
          ? this.removeSessionEntry(row.sessionId, row.memoryKey)
          : false;
    if (removed) {
      await this.audit(userId, 'approval.revoke', approvalId, { memoryKey: row.memoryKey });
    }
    return removed;
  }

  async listPending(userId: string): Promise<ApprovalRequest[]> {
    return this.approvalRequests.listPendingForUser(userId);
  }

  private async autoDeny(
    input: GateInput,
    reason: string,
    blockedMessage: string,
    metric: string,
  ): Promise<GateResult> {
    const row = await this.approvalRequests.create({
      userId: input.userId,
      agentRunId: input.agentRunId,
      sessionId: input.sessionId,
      toolName: input.toolName,
      paramsSummary: redactParamsSummary(input.params),
      status: 'DENIED',
      resolutionReason: reason,
      resolvedAt: new Date(),
    });
    toolApprovalsTotal.inc({ outcome: metric });
    await this.audit(input.userId, 'approval.autodeny', row.id, { reason, tool: input.toolName });
    return { allowed: false, blockedMessage };
  }

  private async audit(
    userId: string,
    action: string,
    resourceId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.auditLogs.create({
        userId,
        action,
        resource: 'approval_request',
        resourceId,
        details: details as Prisma.InputJsonValue,
      });
    } catch (err: unknown) {
      logger.error({ err, action }, 'Audit write failed');
    }
  }

  private async safeDeliver(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err: unknown) {
      logger.warn({ err }, 'Approval delivery side-channel failed (non-fatal)');
    }
  }
}
