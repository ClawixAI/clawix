/**
 * Cron tool — list/create/remove scheduled tasks for agent use.
 *
 * - list: always allowed, returns user's cron jobs
 * - create: blocked during cron execution, gated by CronGuardService.canCreate()
 * - remove: blocked during cron execution, verifies ownership before deleting
 */
import { createLogger } from '@clawix/shared';
import type { CronSchedule } from '@clawix/shared';

import type { CronGuardService } from '../cron-guard.service.js';
import { computeNextRun } from '../cron-next-run.js';
import type { ChannelRepository } from '../../db/channel.repository.js';
import type { TaskRepository } from '../../db/task.repository.js';
import type { TaskRunRepository } from '../../db/task-run.repository.js';
import type { TaskRunMessageRepository } from '../../db/task-run-message.repository.js';
import type { Tool, ToolResult } from '../tool.js';
import type { ToolRegistry } from '../tool-registry.js';

const logger = createLogger('engine:tools:cron');

const VALID_CHANNEL_TYPES = new Set(['telegram', 'slack', 'whatsapp', 'web']);

// ------------------------------------------------------------------ //
//  Helpers                                                            //
// ------------------------------------------------------------------ //

function ok(output: string): ToolResult {
  return { output, isError: false };
}

function err(output: string): ToolResult {
  return { output, isError: true };
}

// ------------------------------------------------------------------ //
//  Policy type                                                        //
// ------------------------------------------------------------------ //

export interface CronPolicy {
  readonly cronEnabled: boolean;
  readonly maxScheduledTasks: number;
  readonly minCronIntervalSecs: number;
  readonly maxTokensPerCronRun: number | null;
}

// ------------------------------------------------------------------ //
//  createCronTool                                                     //
// ------------------------------------------------------------------ //

/**
 * Creates a cron tool bound to a user, agent definition, and policy.
 *
 * The tool provides list/create/remove actions for managing scheduled tasks.
 * Mutating actions (create/remove) are blocked during cron execution to
 * prevent recursive scheduling loops.
 */
export function createCronTool(
  cronGuard: CronGuardService,
  taskRepo: TaskRepository,
  channelRepo: ChannelRepository,
  userId: string,
  agentDefinitionId: string,
  policy: CronPolicy,
  isInCronExecution: boolean,
  sessionChannelId: string | null,
  taskRunRepo: TaskRunRepository,
  taskRunMessageRepo: TaskRunMessageRepository,
  defaultTz: string,
): Tool {
  return {
    name: 'cron',
    description:
      'Manage scheduled tasks (cron jobs). Use list/runs to read existing jobs and their history, ' +
      'runDetail to fetch a specific run transcript, ' +
      'create to schedule a recurring prompt, and remove to delete a job. ' +
      'Scheduled tasks run automatically and trigger the agent with the given prompt.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'create', 'remove', 'runs', 'runDetail'],
          description: 'The action to perform.',
        },
        name: {
          type: 'string',
          description: 'Job name (for create).',
        },
        prompt: {
          type: 'string',
          description: 'What to tell the agent on each trigger (for create).',
        },
        schedule: {
          type: 'string',
          description:
            'JSON schedule object. Examples: ' +
            '{"type":"every","interval":"1h"}, ' +
            '{"type":"cron","expression":"0 9 * * MON-FRI","tz":"America/New_York"}, ' +
            '{"type":"at","time":"2026-04-01T09:00:00Z"}. ' +
            `If tz is omitted on a cron schedule, the org default (${defaultTz}) is used. ` +
            'at schedules must include a timezone offset (Z or ±HH:MM).',
        },
        channel: {
          type: 'string',
          enum: ['telegram', 'slack', 'whatsapp', 'web', 'none'],
          description:
            'Where to deliver results. Use a channel type (telegram, slack, whatsapp, web) ' +
            'or "none" to suppress delivery. Omit to use the current conversation channel.',
        },
        jobId: {
          type: 'string',
          description: 'Job ID (for remove, runs, and runDetail).',
        },
        runId: {
          type: 'string',
          description: 'Run ID (for runDetail).',
        },
        limit: {
          type: 'number',
          description: 'Max number of runs to return (for runs). Default 10, max 50.',
        },
        status: {
          type: 'string',
          enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
          description: 'Filter by run status (for runs).',
        },
      },
      required: ['action'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const action = params['action'] as string;

      // ---------------------------------------------------------------- //
      //  list                                                             //
      // ---------------------------------------------------------------- //
      if (action === 'list') {
        const tasks = await taskRepo.findByUser(userId);
        const jobs = tasks.map((task) => ({
          jobId: task.id,
          name: task.name,
          schedule: task.schedule,
          prompt: task.prompt,
          channelId: task.channelId ?? null,
          enabled: task.enabled,
          nextRunAt: task.nextRunAt?.toISOString() ?? null,
          lastRunAt: task.lastRunAt?.toISOString() ?? null,
          lastStatus: task.lastStatus ?? null,
          consecutiveFailures: task.consecutiveFailures,
        }));

        logger.debug({ userId, count: jobs.length }, 'Cron list completed');
        return ok(JSON.stringify({ jobs }));
      }

      // ---------------------------------------------------------------- //
      //  create                                                           //
      // ---------------------------------------------------------------- //
      if (action === 'create') {
        if (isInCronExecution) {
          return err('Cannot create cron jobs during scheduled execution.');
        }

        const name = params['name'] as string | undefined;
        const prompt = params['prompt'] as string | undefined;
        const scheduleRaw = params['schedule'] as string | undefined;
        const channelParam = params['channel'] as string | undefined;

        // Resolve channelId:
        //   omitted        → current session channel
        //   "none"         → null (no delivery)
        //   channel type   → look up first active channel of that type
        let channelId: string | null;
        if (channelParam === undefined) {
          channelId = sessionChannelId;
        } else if (channelParam === 'none') {
          channelId = null;
        } else if (VALID_CHANNEL_TYPES.has(channelParam)) {
          const channels = await channelRepo.findByType(
            channelParam as 'telegram' | 'slack' | 'whatsapp' | 'web',
          );
          const active = channels.find((ch) => ch.isActive);
          if (!active) {
            return err(`No active ${channelParam} channel configured.`);
          }
          channelId = active.id;
        } else {
          return err(
            `Invalid channel: "${channelParam}". Use telegram, slack, whatsapp, web, or none.`,
          );
        }

        if (!name) {
          return err('Missing required field: name.');
        }
        if (!prompt) {
          return err('Missing required field: prompt.');
        }
        if (!scheduleRaw) {
          return err('Missing required field: schedule.');
        }

        let schedule: CronSchedule;
        try {
          schedule = JSON.parse(scheduleRaw) as CronSchedule;
        } catch {
          return err('Invalid schedule: must be a valid JSON string.');
        }

        const guardResult = await cronGuard.canCreate(
          userId,
          schedule,
          { isInCronExecution },
          policy,
          defaultTz,
        );

        if (!guardResult.allowed) {
          return err(guardResult.reason ?? 'Cron creation denied.');
        }

        const task = await taskRepo.create({
          agentDefinitionId,
          name,
          schedule,
          prompt,
          channelId: channelId ?? null,
          enabled: true,
          createdByUserId: userId,
        });

        // Compute and persist initial nextRunAt so the scheduler picks it up
        const nextRunAt = computeNextRun(schedule, defaultTz);
        if (nextRunAt) {
          await taskRepo.updateNextRunAt(task.id, nextRunAt);
        }

        logger.info({ taskId: task.id, userId, agentDefinitionId }, 'Cron job created');
        return ok(
          JSON.stringify({
            jobId: task.id,
            name: task.name,
            schedule: task.schedule,
            nextRunAt: nextRunAt?.toISOString() ?? null,
          }),
        );
      }

      // ---------------------------------------------------------------- //
      //  remove                                                           //
      // ---------------------------------------------------------------- //
      if (action === 'remove') {
        if (isInCronExecution) {
          return err('Cannot remove cron jobs during scheduled execution.');
        }

        const jobId = params['jobId'] as string | undefined;

        if (!jobId) {
          return err('Missing required field: jobId.');
        }

        let task: Awaited<ReturnType<typeof taskRepo.findById>>;
        try {
          task = await taskRepo.findById(jobId);
        } catch {
          return err('Cron job not found.');
        }

        if (task.createdByUserId !== userId) {
          return err('You can only remove your own cron jobs.');
        }

        await taskRepo.delete(jobId);

        logger.info({ jobId, userId }, 'Cron job removed');
        return ok(JSON.stringify({ jobId, removed: true }));
      }

      // ---------------------------------------------------------------- //
      //  runs                                                             //
      // ---------------------------------------------------------------- //
      if (action === 'runs') {
        const jobId = params['jobId'] as string | undefined;
        if (!jobId) return err('Missing required field: jobId.');

        let task: Awaited<ReturnType<typeof taskRepo.findById>>;
        try {
          task = await taskRepo.findById(jobId);
        } catch {
          return err('Cron job not found.');
        }
        if (task.createdByUserId !== userId) return err('Cron job not found.');

        const rawLimit = typeof params['limit'] === 'number' ? (params['limit'] as number) : 10;
        const limit = Math.min(Math.max(rawLimit, 1), 50);
        const statusParam = params['status'] as string | undefined;
        const validStatus =
          statusParam === 'pending' ||
          statusParam === 'running' ||
          statusParam === 'completed' ||
          statusParam === 'failed' ||
          statusParam === 'cancelled'
            ? statusParam
            : undefined;

        const runs = await taskRunRepo.findByTaskIdWithLimit(jobId, limit, validStatus);
        const rows = runs.map((run) => ({
          runId: run.id,
          status: run.status,
          startedAt: run.startedAt.toISOString(),
          completedAt: run.completedAt?.toISOString() ?? null,
          durationMs: run.durationMs ?? null,
          tokenUsage: run.tokenUsage,
          output: run.output
            ? run.output.length > 2000
              ? `${run.output.slice(0, 2000)}… [truncated ${run.output.length - 2000} chars]`
              : run.output
            : null,
          error: run.error ?? null,
        }));

        logger.debug({ userId, jobId, count: rows.length }, 'Cron runs fetched');
        return ok(JSON.stringify({ runs: rows }));
      }

      // ---------------------------------------------------------------- //
      //  runDetail                                                        //
      // ---------------------------------------------------------------- //
      if (action === 'runDetail') {
        const jobId = params['jobId'] as string | undefined;
        const runId = params['runId'] as string | undefined;
        if (!jobId) return err('Missing required field: jobId.');
        if (!runId) return err('Missing required field: runId.');

        let task: Awaited<ReturnType<typeof taskRepo.findById>>;
        try {
          task = await taskRepo.findById(jobId);
        } catch {
          return err('Cron job not found.');
        }
        if (task.createdByUserId !== userId) return err('Cron job not found.');

        let run: Awaited<ReturnType<typeof taskRunRepo.findById>>;
        try {
          run = await taskRunRepo.findById(runId);
        } catch {
          return err('Cron run not found.');
        }
        if (run.taskId !== jobId) return err('Cron run not found.');

        const allMessages = await taskRunMessageRepo.findByTaskRunId(runId);
        const MAX_MSGS = 50;
        const MAX_CONTENT = 8000;
        let messages = allMessages.map((m) => ({
          role: m.role,
          content:
            m.content.length > MAX_CONTENT
              ? `${m.content.slice(0, MAX_CONTENT)}… [truncated ${m.content.length - MAX_CONTENT} chars]`
              : m.content,
          ...(m.toolCallId != null ? { toolCallId: m.toolCallId } : {}),
          ...(m.toolCalls != null ? { toolCalls: m.toolCalls } : {}),
        }));
        if (messages.length > MAX_MSGS) {
          const dropped = messages.length - MAX_MSGS;
          const kept = messages.slice(-MAX_MSGS);
          messages = [
            { role: 'system', content: `[truncated: ${dropped} earlier messages]` },
            ...kept,
          ];
        }

        logger.debug(
          { userId, jobId, runId, messageCount: messages.length },
          'Cron runDetail fetched',
        );
        return ok(
          JSON.stringify({
            runId: run.id,
            status: run.status,
            startedAt: run.startedAt.toISOString(),
            completedAt: run.completedAt?.toISOString() ?? null,
            durationMs: run.durationMs ?? null,
            tokenUsage: run.tokenUsage,
            output: run.output,
            error: run.error ?? null,
            messages,
          }),
        );
      }

      return err(`Unknown action: ${action}`);
    },
  };
}

// ------------------------------------------------------------------ //
//  registerCronTools                                                  //
// ------------------------------------------------------------------ //

/**
 * Register the cron tool into the given registry if the policy allows it.
 */
export function registerCronTools(
  registry: ToolRegistry,
  cronGuard: CronGuardService,
  taskRepo: TaskRepository,
  channelRepo: ChannelRepository,
  userId: string,
  agentDefinitionId: string,
  policy: CronPolicy,
  isInCronExecution: boolean,
  sessionChannelId: string | null,
  taskRunRepo: TaskRunRepository,
  taskRunMessageRepo: TaskRunMessageRepository,
  defaultTz: string,
): void {
  if (policy.cronEnabled) {
    registry.register(
      createCronTool(
        cronGuard,
        taskRepo,
        channelRepo,
        userId,
        agentDefinitionId,
        policy,
        isInCronExecution,
        sessionChannelId,
        taskRunRepo,
        taskRunMessageRepo,
        defaultTz,
      ),
    );
  }
}
