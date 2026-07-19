import { describe, it, expect, vi } from 'vitest';
import type { LLMProvider, LLMResponse, ChatMessage } from '@clawix/shared';

import { ReasoningLoop } from '../reasoning-loop.js';
import { ToolRegistry } from '../tool-registry.js';
import { RunActivityRegistry } from '../run-activity.registry.js';
import type { Tool, ToolResult } from '../tool.js';
import {
  ToolApprovalService,
  type ApprovalDeliveryPort,
} from '../../approvals/tool-approval.service.js';
import type { ApprovalRequestRepository } from '../../db/approval-request.repository.js';
import type { UserToolApprovalRepository } from '../../db/user-tool-approval.repository.js';
import type { AuditLogRepository } from '../../db/audit-log.repository.js';
import type { ApprovalChoice } from '../../approvals/approval.types.js';

/**
 * End-to-end proof that the approval gate composes correctly with a real
 * ReasoningLoop + ToolRegistry + ToolApprovalService: a sensitive tool call
 * really is intercepted before `execute()`, the rendezvous really unblocks
 * on `resolve()`, a standing deny really short-circuits without waiting, a
 * sub-agent really gets the hardcoded auto-deny, and session-scoped memory
 * really persists across two calls within one run.
 *
 * Only the `ApprovalDeliveryPort` seam and the DB repositories are mocked
 * (in-memory) — same harness shape as `agent-loop-hang-tracing.integration.test.ts`.
 * Real timers throughout (no `vi.useFakeTimers()`): the rendezvous resolves
 * via a same-tick `setTimeout(0)` scheduled from the mocked `deliverPrompt`,
 * which fires only after `gate()` has registered the pending entry.
 */

/* ------------------------------------------------------------------ */
/*  In-memory fakes for the approval repositories                      */
/* ------------------------------------------------------------------ */

interface FakeApprovalRow {
  id: string;
  userId: string;
  agentRunId: string;
  sessionId: string | null;
  toolName: string;
  paramsSummary: Record<string, string>;
  status: string;
  scope?: string;
  resolutionReason?: string;
  memoryStore?: string;
  memoryKey?: string;
  resolvedAt?: Date;
}

function makeApprovalRequestRepo() {
  const rows: FakeApprovalRow[] = [];
  let nextId = 0;
  return {
    rows,
    create: vi.fn(async (input: Omit<FakeApprovalRow, 'id' | 'status'> & { status?: string }) => {
      const row: FakeApprovalRow = { id: `req-${++nextId}`, status: 'PENDING', ...input };
      rows.push(row);
      return row;
    }),
    findById: vi.fn(async (id: string) => rows.find((r) => r.id === id) ?? null),
    listPendingForUser: vi.fn(async (userId: string) =>
      rows.filter((r) => r.userId === userId && r.status === 'PENDING'),
    ),
    transitionStatus: vi.fn(
      async (
        id: string,
        from: string,
        patch: {
          status: string;
          scope?: string;
          resolutionReason?: string;
          memoryStore?: string;
          memoryKey?: string;
        },
      ) => {
        const row = rows.find((r) => r.id === id);
        if (!row || row.status !== from) return false;
        Object.assign(row, patch, { resolvedAt: new Date() });
        return true;
      },
    ),
    expireAllPending: vi.fn(async () => 0),
  };
}

interface FakeStandingRow {
  id: string;
  userId: string;
  toolName: string;
  resourceKey: string;
  decision: 'allowed' | 'denied';
}

function makeUserToolApprovalRepo(seed: readonly FakeStandingRow[] = []) {
  const rows: FakeStandingRow[] = [...seed];
  return {
    rows,
    upsert: vi.fn(
      async (input: {
        userId: string;
        toolName: string;
        resourceKey: string;
        decision: 'allowed' | 'denied';
      }) => {
        const row: FakeStandingRow = { id: `uta-${rows.length}`, ...input };
        rows.push(row);
        return row;
      },
    ),
    findForKeys: vi.fn(async (userId: string, toolName: string, resourceKeys: readonly string[]) =>
      rows.filter(
        (r) =>
          r.userId === userId && r.toolName === toolName && resourceKeys.includes(r.resourceKey),
      ),
    ),
    listForUser: vi.fn(async (userId: string) => rows.filter((r) => r.userId === userId)),
    deleteByKey: vi.fn(async () => true),
  };
}

function makeAuditLogRepo() {
  return { create: vi.fn(async () => ({})) };
}

/* ------------------------------------------------------------------ */
/*  Scripted provider + response builders                              */
/* ------------------------------------------------------------------ */

function toolCallResponse(toolName: string, id: string): LLMResponse {
  return {
    content: null,
    toolCalls: [{ id, name: toolName, arguments: {} }],
    thinkingBlocks: null,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'tool_use',
  };
}

function finalResponse(content: string): LLMResponse {
  return {
    content,
    toolCalls: [],
    thinkingBlocks: null,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  };
}

/** Provider that replays a fixed script of responses, one per `chat()` call. */
function scriptedProvider(responses: readonly LLMResponse[]): LLMProvider {
  let call = 0;
  return {
    name: 'scripted',
    chat: vi.fn(async () => {
      const response = responses[Math.min(call, responses.length - 1)]!;
      call += 1;
      return response;
    }),
  };
}

/* ------------------------------------------------------------------ */
/*  Harness                                                             */
/* ------------------------------------------------------------------ */

const USER_ID = 'user-1';
const AGENT_RUN_ID = 'run-1';
const SENSITIVE_TOOL = 'sensitive_tool';

interface HarnessOptions {
  readonly isSubAgent?: boolean;
  readonly sessionId?: string | null;
  readonly seedStandingDeny?: boolean;
  /** When set, the mocked `deliverPrompt` schedules `resolve(choice)` shortly after gate() registers the pending entry. */
  readonly autoResolveChoice?: ApprovalChoice;
}

function buildHarness(opts: HarnessOptions = {}) {
  const executed = { count: 0 };
  const tool: Tool = {
    name: SENSITIVE_TOOL,
    description: 'A tool that requires human approval before it runs.',
    parameters: { type: 'object', properties: {}, required: [] },
    requiresApproval: true,
    async execute(): Promise<ToolResult> {
      executed.count += 1;
      return { output: 'tool executed', isError: false };
    },
  };

  const requestRepo = makeApprovalRequestRepo();
  const userApprovalRepo = makeUserToolApprovalRepo(
    opts.seedStandingDeny
      ? [
          {
            id: 'uta-seed',
            userId: USER_ID,
            toolName: SENSITIVE_TOOL,
            resourceKey: '',
            decision: 'denied',
          },
        ]
      : [],
  );
  const auditLogs = makeAuditLogRepo();

  // eslint-disable-next-line prefer-const -- assigned after construction, read only inside the deliverPrompt closure
  let approvalService: ToolApprovalService;
  const delivery = {
    deliverPrompt: vi.fn(async (req: { approvalId: string; userId: string }) => {
      if (opts.autoResolveChoice) {
        // Fires as a macrotask, strictly after gate() has finished the
        // synchronous continuation that registers the pending rendezvous
        // entry — so `resolve()` always finds it. Real timers throughout.
        setTimeout(() => {
          void approvalService.resolve(req.approvalId, req.userId, opts.autoResolveChoice!);
        }, 0);
      }
    }),
    deliverNotice: vi.fn(async () => undefined),
    deliverResolved: vi.fn(async () => undefined),
  };

  const runActivity = new RunActivityRegistry();
  approvalService = new ToolApprovalService(
    userApprovalRepo as unknown as UserToolApprovalRepository,
    requestRepo as unknown as ApprovalRequestRepository,
    auditLogs as unknown as AuditLogRepository,
    delivery as unknown as ApprovalDeliveryPort,
    runActivity,
  );

  const toolRegistry = new ToolRegistry();
  toolRegistry.register(tool);
  toolRegistry.setApprovalContext({
    userId: USER_ID,
    agentRunId: AGENT_RUN_ID,
    sessionId: opts.sessionId === undefined ? 'sess-1' : opts.sessionId,
    isSubAgent: opts.isSubAgent ?? false,
    gate: (input) => approvalService.gate(input),
  });

  return { toolRegistry, approvalService, delivery, requestRepo, userApprovalRepo, executed };
}

async function runLoop(
  toolRegistry: ToolRegistry,
  responses: readonly LLMResponse[],
): Promise<{ content: string | null; iterations: number; messages: readonly ChatMessage[] }> {
  const provider = scriptedProvider(responses);
  const loop = new ReasoningLoop(provider, toolRegistry, { compress: vi.fn() } as never, {
    provider: 'mock',
    model: 'test',
  });
  const result = await loop.run([{ role: 'user', content: 'please do the sensitive thing' }]);
  return { content: result.content, iterations: result.iterations, messages: result.messages };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                               */
/* ------------------------------------------------------------------ */

describe('tool-call approval — end-to-end (ReasoningLoop + ToolRegistry + ToolApprovalService)', () => {
  it('1. allow_once: PENDING row created, prompt delivered, tool executes on resolve, loop completes', async () => {
    const h = buildHarness({ autoResolveChoice: 'allow_once' });

    const { content } = await runLoop(h.toolRegistry, [
      toolCallResponse(SENSITIVE_TOOL, 'tc-1'),
      finalResponse('all set'),
    ]);

    expect(h.delivery.deliverPrompt).toHaveBeenCalledTimes(1);
    expect(h.requestRepo.rows).toHaveLength(1);
    expect(h.requestRepo.rows[0]).toMatchObject({ status: 'APPROVED', scope: 'once' });
    expect(h.executed.count).toBe(1);
    expect(content).toBe('all set');
  });

  it('2. deny_once: tool NOT executed, BLOCKED tool-result fed to model, loop continues to final response', async () => {
    const h = buildHarness({ autoResolveChoice: 'deny_once' });

    const { content, messages, iterations } = await runLoop(h.toolRegistry, [
      toolCallResponse(SENSITIVE_TOOL, 'tc-1'),
      finalResponse('understood, not proceeding'),
    ]);

    expect(h.delivery.deliverPrompt).toHaveBeenCalledTimes(1);
    expect(h.executed.count).toBe(0);
    const toolMessage = messages.find((m) => m.role === 'tool');
    expect(toolMessage?.content).toContain('BLOCKED');
    expect(toolMessage?.content).toContain('denied');
    expect(iterations).toBe(2);
    expect(content).toBe('understood, not proceeding');
  });

  it('3. standing persistent deny: immediate BLOCKED, notice delivered (not prompt), no rendezvous delay', async () => {
    const h = buildHarness({ seedStandingDeny: true });

    const start = Date.now();
    const { messages } = await runLoop(h.toolRegistry, [
      toolCallResponse(SENSITIVE_TOOL, 'tc-1'),
      finalResponse('acknowledged'),
    ]);
    const elapsedMs = Date.now() - start;

    expect(h.executed.count).toBe(0);
    expect(h.delivery.deliverPrompt).not.toHaveBeenCalled();
    expect(h.delivery.deliverNotice).toHaveBeenCalledTimes(1);
    expect(h.delivery.deliverNotice).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'standing_deny' }),
    );
    expect(h.requestRepo.rows).toHaveLength(1);
    expect(h.requestRepo.rows[0]).toMatchObject({
      status: 'DENIED',
      resolutionReason: 'standing_deny',
      memoryStore: 'persistent',
    });
    const toolMessage = messages.find((m) => m.role === 'tool');
    expect(toolMessage?.content).toContain('standing denial');
    // No rendezvous wait was ever entered — this resolves near-instantly with real timers.
    expect(elapsedMs).toBeLessThan(1000);
  });

  it('4. sub-agent context: real behavior is a hardcoded auto-deny with no delivery at all', async () => {
    const h = buildHarness({ isSubAgent: true });

    const { messages } = await runLoop(h.toolRegistry, [
      toolCallResponse(SENSITIVE_TOOL, 'tc-1'),
      finalResponse('cannot proceed without approval'),
    ]);

    expect(h.executed.count).toBe(0);
    expect(h.delivery.deliverPrompt).not.toHaveBeenCalled();
    expect(h.delivery.deliverNotice).not.toHaveBeenCalled();
    expect(h.delivery.deliverResolved).not.toHaveBeenCalled();
    expect(h.requestRepo.rows).toHaveLength(1);
    expect(h.requestRepo.rows[0]).toMatchObject({ status: 'DENIED', resolutionReason: 'subagent' });
    const toolMessage = messages.find((m) => m.role === 'tool');
    expect(toolMessage?.content).toContain('sub-agents cannot request');
  });

  it('5. session-allow: a second call to the same key executes silently, no new ApprovalRequest row', async () => {
    const h = buildHarness({ autoResolveChoice: 'allow_session' });

    const { content, iterations } = await runLoop(h.toolRegistry, [
      toolCallResponse(SENSITIVE_TOOL, 'tc-1'),
      toolCallResponse(SENSITIVE_TOOL, 'tc-2'),
      finalResponse('both done'),
    ]);

    expect(h.executed.count).toBe(2);
    // Only the first call ever prompted; the second hit session memory.
    expect(h.delivery.deliverPrompt).toHaveBeenCalledTimes(1);
    expect(h.requestRepo.rows).toHaveLength(1);
    expect(h.requestRepo.rows[0]).toMatchObject({ status: 'APPROVED', scope: 'session' });
    expect(iterations).toBe(3);
    expect(content).toBe('both done');
  });
});
