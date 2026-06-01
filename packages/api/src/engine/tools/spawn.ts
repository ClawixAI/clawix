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

/** Minimal interface for TaskExecutorService (avoids circular import). */
interface TaskSubmitter {
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
    },
  ): void;
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

      let agentDefId: string;
      let displayName: string;

      if (agentName) {
        // Named spawn: look up the worker by name
        const agentDef = await agentDefRepo.findByName(agentName);

        if (!agentDef) {
          logger.warn({ agentName }, 'Agent definition not found');
          return {
            output: `Agent not found: "${agentName}". Verify the agent name and try again.`,
            isError: true,
          };
        }

        if (agentDef.role !== 'worker') {
          logger.warn({ agentName, role: agentDef.role }, 'Cannot spawn non-worker agent');
          return {
            output: `Agent "${agentName}" is not a worker agent and cannot be spawned as a sub-agent.`,
            isError: true,
          };
        }

        agentDefId = agentDef.id;
        displayName = agentName;
      } else {
        // Anonymous spawn: use the default worker
        const defaultWorker = await agentDefRepo.findOrCreateDefaultWorker();
        agentDefId = defaultWorker.id;
        displayName = 'default-worker';
      }

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
        });
      }

      return {
        output: `Spawned agent "${displayName}" as task ${agentRun.id}. It will be processed asynchronously.`,
        isError: false,
      };
    },
  };
}
