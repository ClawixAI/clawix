/**
 * Task cooperation tools — wave fan-out and bounded in-run fan-in.
 *
 * - `spawn_batch` — atomic multi-dispatch of sub-agent tasks; returns a waveId
 *   plus per-task ids so the parent can track the whole wave.
 * - `task_status` — non-blocking status probe by waveId or task ids.
 * - `task_wait`  — bounded in-run gather (any / all / count-n, hard timeout).
 *   Settled results consumed here are removed from the delivery queue so the
 *   batch-drain reinvocation never double-delivers them.
 *
 * task_wait polls run rows once per second. Mutual exclusion with the
 * delivery path is by design: delivery defers while the parent session has an
 * active primary run, and task_wait only ever executes inside one.
 */
import { randomUUID } from 'node:crypto';

import { createLogger } from '@clawix/shared';

import type { Tool, ToolExecuteContext, ToolResult } from '../tool.js';
import type { AgentDefinitionRepository } from '../../db/agent-definition.repository.js';
import type { AgentRunRepository } from '../../db/agent-run.repository.js';
import type { RedisService } from '../../cache/redis.service.js';
import type { BudgetTracker } from '../budget-tracker.js';
import type { SubAgentResultPayload } from '../sub-agent-result.publisher.js';
import { KEY_PREFIXES, DEFAULT_TTL } from '../../cache/cache.constants.js';
import { resolveSpawnTarget, type SpawnUserQuota, type TaskSubmitter } from './spawn.js';

const logger = createLogger('engine:tools:task-tools');

/** Hard cap on tasks per spawn_batch call. */
export const MAX_WAVE_SIZE = 20;
/** task_wait polling interval. */
const WAIT_POLL_INTERVAL_MS = 1000;
/** task_wait timeout bounds. */
const WAIT_TIMEOUT_DEFAULT_MS = 60_000;
const WAIT_TIMEOUT_MAX_MS = 180_000;
const WAIT_TIMEOUT_MIN_MS = 1_000;

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

/** Shared dependencies for the task cooperation tools. */
export interface TaskToolDeps {
  readonly agentDefRepo: AgentDefinitionRepository;
  readonly agentRunRepo: AgentRunRepository;
  readonly taskExecutor: TaskSubmitter | null;
  readonly redis: RedisService;
  readonly parentSessionId: string;
  readonly parentAgentRunId: string;
  readonly userId: string;
  readonly budgetTracker?: BudgetTracker;
  readonly subAgentTimeoutMs?: number;
  readonly allowedProviders?: string[];
  readonly userQuota?: SpawnUserQuota;
}

interface BatchTaskInput {
  readonly agent_name?: string;
  readonly prompt: string;
}

export interface TaskProbe {
  readonly taskId: string;
  readonly status: string;
  readonly output: string | null;
  readonly error: string | null;
}

/** Resolve the target task-id list from wave_id / task_ids params. */
async function resolveTaskIds(
  redis: RedisService,
  params: Record<string, unknown>,
): Promise<{ ids: string[] } | { error: string }> {
  const waveId = params['wave_id'] as string | undefined;
  const taskIds = params['task_ids'] as string[] | undefined;

  if (waveId) {
    const ids = await redis.get<string[]>(KEY_PREFIXES.agentWave + waveId);
    if (!ids || ids.length === 0) {
      return { error: `Wave not found: "${waveId}". It may have expired (waves live 24h).` };
    }
    return { ids };
  }
  if (taskIds && taskIds.length > 0) {
    return { ids: taskIds };
  }
  return { error: 'Provide wave_id or a non-empty task_ids array.' };
}

/** Probe the current status of each task id, tolerating unknown ids. */
export async function probeTasks(
  agentRunRepo: AgentRunRepository,
  ids: string[],
): Promise<TaskProbe[]> {
  const probes: TaskProbe[] = [];
  for (const taskId of ids) {
    try {
      const run = await agentRunRepo.findById(taskId);
      probes.push({ taskId, status: run.status, output: run.output, error: run.error });
    } catch {
      probes.push({ taskId, status: 'unknown', output: null, error: 'task id not found' });
    }
  }
  return probes;
}

/**
 * Remove queued delivery payloads for the given settled task ids so the
 * batch-drain reinvocation does not deliver them a second time. Returns the
 * consumed payloads (authoritative output source when present).
 */
export async function consumeQueuedResults(
  redis: RedisService,
  parentSessionId: string,
  settledIds: ReadonlySet<string>,
): Promise<Map<string, SubAgentResultPayload>> {
  const consumed = new Map<string, SubAgentResultPayload>();
  for (const key of [
    KEY_PREFIXES.agentResults + parentSessionId,
    KEY_PREFIXES.agentProcessing + parentSessionId,
  ]) {
    const raws = await redis.lrange(key, 0, -1);
    for (const raw of raws) {
      try {
        const payload = JSON.parse(raw) as SubAgentResultPayload;
        if (settledIds.has(payload.agentRunId)) {
          const removed = await redis.lrem(key, 1, raw);
          if (removed > 0) consumed.set(payload.agentRunId, payload);
        }
      } catch {
        // Unparseable entries are the delivery sweep's problem, not ours.
      }
    }
  }
  return consumed;
}

/** Format one settled task section for tool output. */
export function formatSettled(probe: TaskProbe, payload?: SubAgentResultPayload): string {
  const status = payload?.status ?? probe.status;
  const body =
    status === 'completed'
      ? (payload?.output ?? probe.output ?? '(no output)')
      : `Error: ${payload?.error ?? probe.error ?? 'Unknown error'}`;
  return [`Task ${probe.taskId} — ${status}`, body].join('\n');
}

/** Create the `spawn_batch` tool. */
export function createSpawnBatchTool(deps: TaskToolDeps): Tool {
  return {
    name: 'spawn_batch',
    description:
      `Dispatch up to ${MAX_WAVE_SIZE} sub-agent tasks as one wave. Returns a wave_id and per-task ids. ` +
      'Results arrive together in a FUTURE turn as a [Sub-Agent Results] message, or gather them ' +
      'within this turn via task_wait. Prefer this over repeated spawn calls for parallel fan-out.',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: `Tasks to dispatch (1-${MAX_WAVE_SIZE}).`,
          items: {
            type: 'object',
            properties: {
              agent_name: {
                type: 'string',
                description: 'Optional worker agent name; omit for an anonymous default worker.',
              },
              prompt: { type: 'string', description: 'Input prompt for the spawned agent.' },
            },
            required: ['prompt'],
          },
        },
      },
      required: ['tasks'],
    },

    async execute(params: Record<string, unknown>, ctx?: ToolExecuteContext): Promise<ToolResult> {
      const tasks = params['tasks'] as BatchTaskInput[];
      if (!Array.isArray(tasks) || tasks.length === 0) {
        return { output: 'spawn_batch requires a non-empty tasks array.', isError: true };
      }
      if (tasks.length > MAX_WAVE_SIZE) {
        return {
          output: `spawn_batch accepts at most ${MAX_WAVE_SIZE} tasks per wave (got ${tasks.length}).`,
          isError: true,
        };
      }

      // Resolve every target before creating anything, so an invalid task
      // fails the whole batch instead of dispatching a partial wave.
      const targets: { agentDefId: string; displayName: string }[] = [];
      for (const [i, task] of tasks.entries()) {
        if (typeof task?.prompt !== 'string' || task.prompt.length === 0) {
          return { output: `Task ${i + 1} has no prompt.`, isError: true };
        }
        const target = await resolveSpawnTarget(
          deps.agentDefRepo,
          task.agent_name,
          deps.allowedProviders,
        );
        if ('error' in target) {
          return { output: `Task ${i + 1}: ${target.error}`, isError: true };
        }
        targets.push(target);
      }

      const waveId = randomUUID();
      const lines: string[] = [];
      const taskIds: string[] = [];

      for (const [i, task] of tasks.entries()) {
        const { agentDefId, displayName } = targets[i]!;
        const agentRun = await deps.agentRunRepo.create({
          agentDefinitionId: agentDefId,
          sessionId: deps.parentSessionId,
          parentAgentRunId: deps.parentAgentRunId,
          input: task.prompt,
          status: 'pending',
          ...(deps.budgetTracker?.budget != null
            ? {
                tokenBudget: deps.budgetTracker.budget,
                tokenGracePercent: deps.budgetTracker.gracePercent,
              }
            : {}),
        });
        taskIds.push(agentRun.id);
        lines.push(`- task ${agentRun.id} (${displayName})`);

        if (deps.taskExecutor) {
          deps.taskExecutor.submit(agentRun.id, {
            agentDefinitionId: agentDefId,
            input: task.prompt,
            userId: deps.userId,
            sessionId: deps.parentSessionId,
            displayName,
            ...(deps.budgetTracker ? { budgetTracker: deps.budgetTracker } : {}),
            ...(ctx?.abortSignal ? { abortSignal: ctx.abortSignal } : {}),
            ...(deps.subAgentTimeoutMs != null ? { timeoutMs: deps.subAgentTimeoutMs } : {}),
            ...(deps.userQuota ? { userQuota: deps.userQuota } : {}),
          });
        }
      }

      await deps.redis.set(KEY_PREFIXES.agentWave + waveId, taskIds, {
        ttlSeconds: DEFAULT_TTL.agentWave,
      });

      logger.info(
        { waveId, taskCount: taskIds.length, parentSessionId: deps.parentSessionId },
        'Dispatched sub-agent wave',
      );

      return {
        output: [
          `Dispatched wave ${waveId} with ${taskIds.length} task(s):`,
          ...lines,
          '',
          'Results arrive together in a FUTURE turn as a [Sub-Agent Results] message. ' +
            'To gather within THIS turn call task_wait with the wave_id (bounded timeout); ' +
            'check progress anytime with task_status. Never shell-sleep or busy-poll.',
        ].join('\n'),
        isError: false,
      };
    },
  };
}

/** Create the `task_status` tool. */
export function createTaskStatusTool(deps: TaskToolDeps): Tool {
  return {
    name: 'task_status',
    description:
      'Non-blocking status probe for spawned tasks. Pass wave_id (from spawn_batch) or task_ids. ' +
      'Returns each task’s current status without waiting.',
    parameters: {
      type: 'object',
      properties: {
        wave_id: { type: 'string', description: 'Wave id returned by spawn_batch.' },
        task_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Explicit task ids (alternative to wave_id).',
        },
      },
      required: [],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const resolved = await resolveTaskIds(deps.redis, params);
      if ('error' in resolved) return { output: resolved.error, isError: true };

      const probes = await probeTasks(deps.agentRunRepo, resolved.ids);
      const settled = probes.filter((p) => TERMINAL_STATUSES.has(p.status)).length;
      const lines = probes.map(
        (p) => `${p.taskId}: ${p.status}${p.status === 'failed' ? ` (${p.error ?? '?'})` : ''}`,
      );
      return {
        output: [`${settled}/${probes.length} settled.`, ...lines].join('\n'),
        isError: false,
      };
    },
  };
}

/** Create the `task_wait` tool. */
export function createTaskWaitTool(deps: TaskToolDeps): Tool {
  return {
    name: 'task_wait',
    description:
      'Wait (bounded) for spawned tasks to settle and return their results in THIS turn. ' +
      'Pass wave_id or task_ids plus mode: "all" (default), "any", or "count" with count=n. ' +
      `Timeout timeout_ms defaults to ${WAIT_TIMEOUT_DEFAULT_MS} and is capped at ${WAIT_TIMEOUT_MAX_MS}; ` +
      'on timeout you get the results settled so far plus pending statuses. ' +
      'Use this instead of sleeping or polling in a loop.',
    parameters: {
      type: 'object',
      properties: {
        wave_id: { type: 'string', description: 'Wave id returned by spawn_batch.' },
        task_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Explicit task ids (alternative to wave_id).',
        },
        mode: {
          type: 'string',
          enum: ['any', 'all', 'count'],
          description: 'Satisfaction condition: any one, all, or at least `count` tasks settled.',
        },
        count: {
          type: 'number',
          description: 'Required settled count when mode="count".',
        },
        timeout_ms: {
          type: 'number',
          description: `Max wait in ms (${WAIT_TIMEOUT_MIN_MS}-${WAIT_TIMEOUT_MAX_MS}).`,
        },
      },
      required: [],
    },

    async execute(params: Record<string, unknown>, ctx?: ToolExecuteContext): Promise<ToolResult> {
      const resolved = await resolveTaskIds(deps.redis, params);
      if ('error' in resolved) return { output: resolved.error, isError: true };
      const ids = resolved.ids;

      const mode = (params['mode'] as string | undefined) ?? 'all';
      const rawCount = params['count'] as number | undefined;
      const required =
        mode === 'any'
          ? 1
          : mode === 'count'
            ? Math.min(Math.max(rawCount ?? 1, 1), ids.length)
            : ids.length;

      const rawTimeout = params['timeout_ms'] as number | undefined;
      const timeoutMs = Math.min(
        Math.max(rawTimeout ?? WAIT_TIMEOUT_DEFAULT_MS, WAIT_TIMEOUT_MIN_MS),
        WAIT_TIMEOUT_MAX_MS,
      );

      const deadline = Date.now() + timeoutMs;
      let probes = await probeTasks(deps.agentRunRepo, ids);
      let timedOut = false;

      while (probes.filter((p) => TERMINAL_STATUSES.has(p.status)).length < required) {
        if (ctx?.abortSignal?.aborted) break;
        if (Date.now() >= deadline) {
          timedOut = true;
          break;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(WAIT_POLL_INTERVAL_MS, Math.max(deadline - Date.now(), 0))),
        );
        probes = await probeTasks(deps.agentRunRepo, ids);
      }

      const settledProbes = probes.filter((p) => TERMINAL_STATUSES.has(p.status));
      const pendingProbes = probes.filter((p) => !TERMINAL_STATUSES.has(p.status));

      // Consume the settled results from the delivery queue so the later
      // batch-drain reinvocation does not re-deliver what we return here.
      const consumed = await consumeQueuedResults(
        deps.redis,
        deps.parentSessionId,
        new Set(settledProbes.map((p) => p.taskId)),
      );

      const sections = settledProbes.map((p) => formatSettled(p, consumed.get(p.taskId)));
      const header = timedOut
        ? `task_wait timed out after ${timeoutMs}ms with ${settledProbes.length}/${ids.length} settled (needed ${required}).`
        : `${settledProbes.length}/${ids.length} task(s) settled.`;
      const pendingNote =
        pendingProbes.length > 0
          ? [
              '',
              `Still running: ${pendingProbes.map((p) => `${p.taskId} (${p.status})`).join(', ')}.`,
              'Their results arrive in a future [Sub-Agent Results] turn — do not sleep or busy-poll.',
            ]
          : [];

      logger.info(
        {
          parentSessionId: deps.parentSessionId,
          requested: ids.length,
          settled: settledProbes.length,
          consumedFromQueue: consumed.size,
          timedOut,
        },
        'task_wait finished',
      );

      return {
        output: [header, '', ...sections, ...pendingNote].join('\n'),
        isError: false,
      };
    },
  };
}
