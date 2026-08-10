/**
 * Spawn tool — queues a new agent run as a child task of the current session.
 *
 * Supports two modes:
 *   1. Named spawn: agent_name is provided → look up a worker AgentDefinition by name.
 *   2. Anonymous spawn: agent_name omitted → use the default-worker definition
 *      (provider and model resolved from the configured default ProviderConfig).
 */
import { createLogger } from '@clawix/shared';

import type { Tool, ToolExecuteContext, ToolResult } from '../tool.js';
import type { AgentDefinitionRepository } from '../../db/agent-definition.repository.js';
import type { AgentRunRepository } from '../../db/agent-run.repository.js';
import type { BudgetTracker } from '../budget-tracker.js';

const logger = createLogger('engine:tools:spawn');

/** Resolved spawn target, or a user-facing error message. */
export type SpawnTarget = { agentDefId: string; displayName: string } | { error: string };

/**
 * Resolve the AgentDefinition a spawn should run: a named worker when
 * `agentName` is given, otherwise the policy-compatible default worker.
 * Shared by the `spawn` and `spawn_batch` tools.
 */
export async function resolveSpawnTarget(
  agentDefRepo: AgentDefinitionRepository,
  agentName: string | undefined,
  allowedProviders?: string[],
): Promise<SpawnTarget> {
  if (agentName) {
    const agentDef = await agentDefRepo.findByName(agentName);
    if (!agentDef) {
      return { error: `Agent not found: "${agentName}". Verify the agent name and try again.` };
    }
    if (agentDef.role !== 'worker') {
      return {
        error: `Agent "${agentName}" is not a worker agent and cannot be spawned as a sub-agent.`,
      };
    }
    return { agentDefId: agentDef.id, displayName: agentName };
  }

  const defaultWorker = await agentDefRepo.findOrCreateDefaultWorkerForPolicy(allowedProviders);
  return { agentDefId: defaultWorker.id, displayName: 'default-worker' };
}

/** Minimal interface for TaskExecutorService (avoids circular import). */
export interface TaskSubmitter {
  submit(
    agentRunId: string,
    options: {
      readonly agentDefinitionId: string;
      readonly input: string;
      readonly userId: string;
      readonly sessionId: string;
      readonly budgetTracker?: BudgetTracker;
      /** Parent abort signal forwarded for cancellation cascade. */
      readonly abortSignal?: AbortSignal;
      /** Wall-clock cap for the sub-agent run (ms), resolved from the user's policy. */
      readonly timeoutMs?: number;
      /** Human-readable agent label, used for progress messages to the parent. */
      readonly displayName?: string;
      /** Per-user fairness quota resolved from the spawning user's policy. */
      readonly userQuota?: { readonly maxConcurrent: number; readonly maxPending: number };
    },
  ): void;
  /**
   * Remove a still-queued task (task_cancel). Optional so lean test doubles
   * and the stub-mode `null` executor stay valid.
   */
  cancelQueued?(agentRunId: string): boolean;
}

/** Per-user executor quota shape passed from policy into spawn submissions. */
export interface SpawnUserQuota {
  readonly maxConcurrent: number;
  readonly maxPending: number;
}

/**
 * Create a spawn tool that queues a new agent run as a pending task.
 *
 * @param agentDefRepo      - Repository for looking up agent definitions.
 * @param agentRunRepo      - Repository for creating agent run records.
 * @param taskExecutor      - Optional task executor to submit runs immediately; pass null for stub mode.
 * @param parentSessionId   - The session ID of the calling agent.
 * @param parentAgentRunId  - The AgentRun ID of the parent agent (used to deliver results back).
 * @param userId            - The ID of the user initiating the spawn.
 * @param budgetTracker     - Optional shared budget tracker inherited by the sub-agent.
 * @param subAgentTimeoutMs - Wall-clock cap (ms) for the spawned run, from the user's policy.
 * @param allowedProviders  - The caller's policy `allowedProviders`; used to resolve an
 *                            in-policy provider for anonymous (default-worker) spawns.
 */
export function createSpawnTool(
  agentDefRepo: AgentDefinitionRepository,
  agentRunRepo: AgentRunRepository,
  taskExecutor: TaskSubmitter | null,
  parentSessionId: string,
  parentAgentRunId: string,
  userId: string,
  budgetTracker?: BudgetTracker,
  subAgentTimeoutMs?: number,
  allowedProviders?: string[],
  userQuota?: SpawnUserQuota,
): Tool {
  return {
    name: 'spawn',
    description:
      'Spawn a sub-agent to handle a task. Provide agent_name to use a specific worker agent, ' +
      'or omit it to spawn an anonymous agent. Returns the new task ID.',
    parameters: {
      type: 'object',
      properties: {
        agent_name: {
          type: 'string',
          description:
            'Optional name of a worker agent to spawn. If omitted, an anonymous default worker is used.',
        },
        prompt: {
          type: 'string',
          description: 'The input prompt to pass to the spawned agent.',
        },
      },
      required: ['prompt'],
    },

    async execute(params: Record<string, unknown>, ctx?: ToolExecuteContext): Promise<ToolResult> {
      const agentName = params['agent_name'] as string | undefined;
      const prompt = params['prompt'] as string;

      logger.debug(
        { agentName: agentName ?? '(anonymous)', parentSessionId },
        'Spawning sub-agent',
      );

      const target = await resolveSpawnTarget(agentDefRepo, agentName, allowedProviders);
      if ('error' in target) {
        logger.warn({ agentName }, 'Spawn target resolution failed');
        return { output: target.error, isError: true };
      }
      const { agentDefId, displayName } = target;

      const agentRun = await agentRunRepo.create({
        agentDefinitionId: agentDefId,
        sessionId: parentSessionId,
        parentAgentRunId,
        input: prompt,
        status: 'pending',
        // Persist the budget so a recovered orphan (after API crash) can
        // rebuild a tracker. Skip when budget is null (no enforcement).
        ...(budgetTracker?.budget != null
          ? {
              tokenBudget: budgetTracker.budget,
              tokenGracePercent: budgetTracker.gracePercent,
            }
          : {}),
      });

      logger.info({ agentName: displayName, agentRunId: agentRun.id }, 'Spawned pending AgentRun');

      if (taskExecutor) {
        taskExecutor.submit(agentRun.id, {
          agentDefinitionId: agentDefId,
          input: prompt,
          userId,
          sessionId: parentSessionId,
          displayName,
          ...(budgetTracker ? { budgetTracker } : {}),
          ...(ctx?.abortSignal ? { abortSignal: ctx.abortSignal } : {}),
          ...(subAgentTimeoutMs != null ? { timeoutMs: subAgentTimeoutMs } : {}),
          ...(userQuota ? { userQuota } : {}),
        });
      }

      return {
        output:
          `Spawned agent "${displayName}" as task ${agentRun.id}. It will be processed asynchronously. ` +
          'The result arrives in a FUTURE turn as a [Sub-Agent Results] message — ' +
          'do not shell-sleep or busy-poll for it. To gather results within THIS turn, ' +
          'use task_wait (bounded) or check progress with task_status; otherwise finish your response now.',
        isError: false,
      };
    },
  };
}
