/**
 * Task lifecycle tools — cancel a spawned task, or fetch a settled result on
 * demand. Completes the WS-C cooperation surface next to spawn_batch /
 * task_status / task_wait (see task-tools.ts).
 *
 * Both tools are session-scoped: they only operate on tasks spawned within
 * the calling parent's session.
 */
import { createLogger } from '@clawix/shared';

import type { Tool, ToolResult } from '../tool.js';
import type { AgentRunRepository } from '../../db/agent-run.repository.js';
import type { RedisService } from '../../cache/redis.service.js';
import type { TaskSubmitter } from './spawn.js';
import { consumeQueuedResults, formatSettled } from './task-tools.js';

const logger = createLogger('engine:tools:task-lifecycle');

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

/** Structural slice of AgentRunRegistry — avoids importing the service class. */
export interface RunAborter {
  abort(agentRunId: string, reason: string): boolean;
}

/** Dependencies shared by task_cancel and task_result. */
export interface TaskLifecycleDeps {
  readonly agentRunRepo: AgentRunRepository;
  readonly redis: RedisService;
  readonly taskExecutor: TaskSubmitter | null;
  readonly agentRunRegistry: RunAborter;
  readonly parentSessionId: string;
}

interface ScopedRun {
  readonly id: string;
  readonly status: string;
  readonly output: string | null;
  readonly error: string | null;
}

/** Load a task and verify it belongs to the calling session. */
async function loadScopedRun(
  deps: TaskLifecycleDeps,
  taskId: string,
): Promise<ScopedRun | { scopeError: string }> {
  try {
    const run = await deps.agentRunRepo.findById(taskId);
    if (run.sessionId !== deps.parentSessionId) {
      return { scopeError: `Task ${taskId} does not belong to this session.` };
    }
    return { id: run.id, status: run.status, output: run.output, error: run.error };
  } catch {
    return { scopeError: `Task not found: ${taskId}.` };
  }
}

/** Create the `task_cancel` tool. */
export function createTaskCancelTool(deps: TaskLifecycleDeps): Tool {
  return {
    name: 'task_cancel',
    description:
      'Cancel a spawned task by id. A queued task is removed before it starts; a running task ' +
      'is aborted. Already-settled tasks are left untouched (use task_result to read them).',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The task id returned by spawn/spawn_batch.' },
      },
      required: ['task_id'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const taskId = params['task_id'] as string;
      const scoped = await loadScopedRun(deps, taskId);
      if ('scopeError' in scoped) return { output: scoped.scopeError, isError: true };

      if (TERMINAL_STATUSES.has(scoped.status)) {
        return {
          output: `Task ${taskId} already settled (${scoped.status}) — nothing to cancel. Use task_result to read its outcome.`,
          isError: false,
        };
      }

      // Queued first (cheap, no process involved); otherwise abort the live run.
      const wasQueued = deps.taskExecutor?.cancelQueued?.(taskId) ?? false;
      const aborted = wasQueued ? false : deps.agentRunRegistry.abort(taskId, 'parent_cancelled');
      const flipped = await deps.agentRunRepo.cancelIfActive(taskId);

      logger.info(
        { taskId, parentSessionId: deps.parentSessionId, wasQueued, aborted, flipped },
        'task_cancel executed',
      );

      if (!wasQueued && !aborted && !flipped) {
        return {
          output: `Task ${taskId} settled while cancelling — no action taken. Use task_result to read its outcome.`,
          isError: false,
        };
      }
      return {
        output: `Task ${taskId} cancelled${wasQueued ? ' (removed from queue before starting)' : aborted ? ' (running work aborted)' : ''}.`,
        isError: false,
      };
    },
  };
}

/** Create the `task_result` tool. */
export function createTaskResultTool(deps: TaskLifecycleDeps): Tool {
  return {
    name: 'task_result',
    description:
      'Fetch the result of a settled task by id, on demand. Consumes the queued delivery for ' +
      'that task so it is not re-delivered later. For unsettled tasks use task_wait or task_status.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The task id returned by spawn/spawn_batch.' },
      },
      required: ['task_id'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const taskId = params['task_id'] as string;
      const scoped = await loadScopedRun(deps, taskId);
      if ('scopeError' in scoped) return { output: scoped.scopeError, isError: true };

      if (!TERMINAL_STATUSES.has(scoped.status)) {
        return {
          output: `Task ${taskId} is still ${scoped.status}. Use task_wait to gather it, or task_status to keep probing — do not sleep or busy-poll.`,
          isError: false,
        };
      }

      // Consume the pending delivery payload (if any) so batch delivery does
      // not hand the parent the same result a second time.
      const consumed = await consumeQueuedResults(
        deps.redis,
        deps.parentSessionId,
        new Set([taskId]),
      );

      return {
        output: formatSettled(
          { taskId, status: scoped.status, output: scoped.output, error: scoped.error },
          consumed.get(taskId),
        ),
        isError: false,
      };
    },
  };
}
