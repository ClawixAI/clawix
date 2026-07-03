import { Injectable } from '@nestjs/common';
import type { Logger } from 'pino';

import { createLogger, type LoggerContext } from '@clawix/shared';

/**
 * Metadata captured when a run is registered. All fields optional — the
 * orphan-recovery path may not know the parent/session at registration time.
 */
export interface RunActivityMeta {
  readonly agentName?: string;
  readonly sessionId?: string;
  readonly parentAgentRunId?: string;
}

/**
 * A point-in-time view of what an agent run is doing. Read by the executor
 * watchdog when a run fails to settle, so the death-log can name the tool the
 * run was stuck in rather than reporting only an opaque timeout.
 */
export interface RunActivitySnapshot {
  readonly agentName: string | null;
  readonly sessionId: string | null;
  readonly parentAgentRunId: string | null;
  /** 1-based iteration index the reasoning loop is currently on (0 before the first). */
  readonly iteration: number;
  /** Name of the tool currently executing, or null when between tool calls. */
  readonly currentToolName: string | null;
  /** `Date.now()` when the current tool started, or null when idle. */
  readonly currentToolStartedAt: number | null;
}

/** Mutable internal record. */
interface RunActivity {
  agentName: string | null;
  sessionId: string | null;
  parentAgentRunId: string | null;
  iteration: number;
  currentToolName: string | null;
  currentToolStartedAt: number | null;
}

/**
 * In-memory registry of live agent-run activity.
 *
 * Two responsibilities:
 *  1. Hand out run-scoped child loggers so every reasoning-loop line carries
 *     `{ agentRunId, sessionId }` and is greppable per-run (concurrent
 *     sub-agents no longer interleave anonymously).
 *  2. Track the last-known activity (iteration + current tool) of each run so
 *     the executor watchdog can report *where* a hung run was stuck.
 *
 * Single-replica scope: entries live only in this process. The stale-run
 * reaper (which handles orphans across restarts) deliberately does not read
 * this — it has no in-memory state for runs whose controllers were lost.
 */
@Injectable()
export class RunActivityRegistry {
  private readonly runs = new Map<string, RunActivity>();

  /** Create a child logger bound to the run's context for per-run traceability. */
  createRunLogger(context: LoggerContext): Logger {
    return createLogger('engine:reasoning-loop', context);
  }

  register(agentRunId: string, meta: RunActivityMeta): void {
    this.runs.set(agentRunId, {
      agentName: meta.agentName ?? null,
      sessionId: meta.sessionId ?? null,
      parentAgentRunId: meta.parentAgentRunId ?? null,
      iteration: 0,
      currentToolName: null,
      currentToolStartedAt: null,
    });
  }

  recordIteration(agentRunId: string, iteration: number): void {
    const run = this.runs.get(agentRunId);
    if (run) run.iteration = iteration;
  }

  recordToolStart(agentRunId: string, toolName: string): void {
    const run = this.runs.get(agentRunId);
    if (run) {
      run.currentToolName = toolName;
      run.currentToolStartedAt = Date.now();
    }
  }

  recordToolEnd(agentRunId: string): void {
    const run = this.runs.get(agentRunId);
    if (run) {
      run.currentToolName = null;
      run.currentToolStartedAt = null;
    }
  }

  unregister(agentRunId: string): void {
    this.runs.delete(agentRunId);
  }

  snapshot(agentRunId: string): RunActivitySnapshot | undefined {
    const run = this.runs.get(agentRunId);
    if (!run) return undefined;
    return {
      agentName: run.agentName,
      sessionId: run.sessionId,
      parentAgentRunId: run.parentAgentRunId,
      iteration: run.iteration,
      currentToolName: run.currentToolName,
      currentToolStartedAt: run.currentToolStartedAt,
    };
  }
}
