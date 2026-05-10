/**
 * PythonContainerPoolService — manages a pool of warm Python runner containers
 * keyed by session ID. Each session gets one sibling Python container that is
 * reused across `python_run` tool calls within the same agent run.
 *
 * Mirrors the patterns of ContainerPoolService but is simpler:
 *   - Keyed by sessionId only (no AgentDefinition dependency)
 *   - No ephemeral overflow — reject when pool is full
 *   - No periodic health-check interval — health is checked on acquire
 *   - Immutable PoolEntry objects (state transitions replace the map entry)
 */
import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { createLogger } from '@clawix/shared';
import type { AgentDefinition } from '@clawix/shared';

import { ContainerRunner } from './container-runner.js';
import type { IContainerRunner } from './container-runner.js';
import { pythonPoolColdStarts, pythonPoolWarmHits } from './tools/python/python-metrics.js';

// ------------------------------------------------------------------ //
//  Constants                                                          //
// ------------------------------------------------------------------ //

const logger = createLogger('engine:python-container-pool');

const HEALTH_CHECK_TIMEOUT_MS = 2_000;

// ------------------------------------------------------------------ //
//  Config                                                             //
// ------------------------------------------------------------------ //

export interface PythonPoolConfig {
  readonly idleTimeoutSec: number;
  readonly maxLifetimeSec: number;
  readonly maxPoolSize: number;
  readonly runnerImage: string;
  readonly proxyNetworkName: string;
}

export const DEFAULT_PYTHON_POOL_CONFIG: PythonPoolConfig = {
  idleTimeoutSec: Number(process.env['PYTHON_POOL_IDLE_TIMEOUT_SEC'] ?? 300),
  maxLifetimeSec: 3600,
  maxPoolSize: Number(process.env['PYTHON_POOL_MAX_SIZE'] ?? 20),
  runnerImage: process.env['PYTHON_RUNNER_IMAGE'] ?? 'clawix-python-runner:latest',
  proxyNetworkName: 'clawix-internal',
};

// ------------------------------------------------------------------ //
//  PoolEntry — immutable                                              //
// ------------------------------------------------------------------ //

interface PoolEntry {
  readonly containerId: string;
  readonly sessionId: string;
  readonly startedAt: Date;
  /** Timestamp (ms since epoch) of the last time this entry was acquired or released. */
  readonly lastUsedAt: number;
  readonly status: 'active' | 'idle';
  readonly idleTimer: ReturnType<typeof setTimeout> | null;
}

// ------------------------------------------------------------------ //
//  AcquireOptions                                                     //
// ------------------------------------------------------------------ //

export interface AcquireOptions {
  readonly workspaceHostPath: string;
  /** Overrides default memory limit; sourced from policy.maxPythonMemoryMb */
  readonly memoryMb?: number;
  /** Overrides default CPU limit; sourced from policy.maxPythonCpuCores */
  readonly cpus?: number;
}

// ------------------------------------------------------------------ //
//  PythonContainerPoolService                                         //
// ------------------------------------------------------------------ //

@Injectable()
export class PythonContainerPoolService implements OnModuleDestroy {
  private readonly pool = new Map<string, PoolEntry>();
  private readonly locks = new Map<string, { promise: Promise<void>; resolve: () => void }>();
  private readonly cfg: PythonPoolConfig;
  private readonly runner: IContainerRunner;

  constructor(
    @Inject(ContainerRunner) runner: IContainerRunner,
    @Optional() @Inject('PYTHON_POOL_CONFIG') config: Partial<PythonPoolConfig> = {},
  ) {
    this.runner = runner;
    this.cfg = { ...DEFAULT_PYTHON_POOL_CONFIG, ...config };
  }

  // ---------------------------------------------------------------- //
  //  acquire()                                                        //
  // ---------------------------------------------------------------- //

  async acquire(sessionId: string, opts: AcquireOptions): Promise<string> {
    await this.acquireLock(sessionId);

    try {
      const existing = this.pool.get(sessionId);

      if (existing !== undefined) {
        // Clear idle timer
        if (existing.idleTimer !== null) {
          clearTimeout(existing.idleTimer);
        }

        // Check max lifetime
        const lifetimeMs = Date.now() - existing.startedAt.getTime();
        if (lifetimeMs > this.cfg.maxLifetimeSec * 1000) {
          logger.info(
            { sessionId, containerId: existing.containerId },
            'python-pool: container exceeded max lifetime — recycling',
          );
          await this.stopAndRemove(sessionId, existing.containerId);
          return await this.startFresh(sessionId, opts);
        }

        // Health check
        const alive = await this.isAlive(existing.containerId);
        if (!alive) {
          logger.warn(
            { sessionId, containerId: existing.containerId },
            'python-pool: warm container failed healthcheck — replacing',
          );
          await this.stopAndRemove(sessionId, existing.containerId);
          return await this.startFresh(sessionId, opts);
        }

        // Reuse — replace entry immutably
        const updated: PoolEntry = {
          ...existing,
          status: 'active',
          idleTimer: null,
          lastUsedAt: Date.now(),
        };
        this.pool.set(sessionId, updated);

        logger.info(
          { sessionId, containerId: existing.containerId, action: 'reuse' },
          'python-pool: acquired warm container',
        );
        pythonPoolWarmHits.inc();
        return existing.containerId;
      }

      // No existing container — start fresh
      return await this.startFresh(sessionId, opts);
    } catch (err) {
      this.releaseLock(sessionId);
      throw err;
    }
  }

  // ---------------------------------------------------------------- //
  //  release()                                                        //
  // ---------------------------------------------------------------- //

  release(sessionId: string): void {
    const entry = this.pool.get(sessionId);
    if (entry === undefined) {
      this.releaseLock(sessionId);
      return;
    }

    const timer = setTimeout(() => {
      logger.info(
        { sessionId, containerId: entry.containerId },
        'python-pool: idle timeout expired — stopping container',
      );
      void this.stopAndRemove(sessionId, entry.containerId);
    }, this.cfg.idleTimeoutSec * 1000);

    timer.unref();

    const updated: PoolEntry = {
      ...entry,
      status: 'idle',
      idleTimer: timer,
      lastUsedAt: Date.now(),
    };
    this.pool.set(sessionId, updated);

    logger.info(
      { sessionId, containerId: entry.containerId, action: 'release' },
      'python-pool: released container to pool',
    );
    this.releaseLock(sessionId);
  }

  // ---------------------------------------------------------------- //
  //  drainAll()                                                       //
  // ---------------------------------------------------------------- //

  async drainAll(): Promise<void> {
    const entries = [...this.pool.entries()];
    this.pool.clear();

    await Promise.all(
      entries.map(async ([, entry]) => {
        if (entry.idleTimer !== null) clearTimeout(entry.idleTimer);
        await this.runner.stop(entry.containerId).catch((err: unknown) => {
          logger.warn(
            { containerId: entry.containerId, err },
            'python-pool: failed to stop container during drain',
          );
        });
      }),
    );

    // Release all locks
    for (const [key, lock] of this.locks) {
      this.locks.delete(key);
      lock.resolve();
    }

    logger.info({ drained: entries.length }, 'python-pool: drained');
  }

  // ---------------------------------------------------------------- //
  //  onModuleDestroy                                                  //
  // ---------------------------------------------------------------- //

  async onModuleDestroy(): Promise<void> {
    await this.drainAll();
  }

  // ---------------------------------------------------------------- //
  //  Private helpers                                                  //
  // ---------------------------------------------------------------- //

  private async startFresh(sessionId: string, opts: AcquireOptions): Promise<string> {
    if (this.pool.size >= this.cfg.maxPoolSize) {
      // LRU eviction of idle containers
      const evicted = await this.evictLru();
      if (!evicted) {
        throw new Error(
          'Python container pool is full — no idle slots available. Please try again.',
        );
      }
    }

    // Build a synthetic AgentDefinition for the Python runner sibling.
    // These containers have no real Agent row in the DB — they are session-scoped siblings.
    const syntheticAgentDef: AgentDefinition = {
      id: `python-runner-${sessionId}`,
      name: `Python Runner (${sessionId})`,
      description: null,
      systemPrompt: '',
      role: 'worker',
      provider: 'none',
      model: 'none',
      apiBaseUrl: null,
      skillIds: [],
      maxTokensPerRun: 0,
      containerConfig: {
        image: this.cfg.runnerImage,
        cpuLimit: String(opts.cpus ?? 1),
        memoryLimit: `${opts.memoryMb ?? 512}m`,
        timeoutSeconds: this.cfg.maxLifetimeSec,
        readOnlyRootfs: false,
        allowedMounts: [],
        idleTimeoutSeconds: this.cfg.idleTimeoutSec,
      },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const containerId = await this.runner.start(syntheticAgentDef, [], {
      disableAutoStop: true,
      workspaceHostPath: opts.workspaceHostPath,
      network: this.cfg.proxyNetworkName,
    });

    const entry: PoolEntry = {
      containerId,
      sessionId,
      startedAt: new Date(),
      lastUsedAt: Date.now(),
      status: 'active',
      idleTimer: null,
    };
    this.pool.set(sessionId, entry);

    logger.info({ sessionId, containerId, action: 'start' }, 'python-pool: container started');
    pythonPoolColdStarts.inc();
    return containerId;
  }

  private async stopAndRemove(sessionId: string, containerId: string): Promise<void> {
    this.pool.delete(sessionId);
    await this.runner.stop(containerId).catch((err: unknown) => {
      logger.warn({ containerId, err }, 'python-pool: failed to stop container');
    });
  }

  private async isAlive(containerId: string): Promise<boolean> {
    try {
      const result = await this.runner.exec(containerId, ['true'], {
        timeout: HEALTH_CHECK_TIMEOUT_MS,
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  private async evictLru(): Promise<boolean> {
    let oldest: { sessionId: string; entry: PoolEntry } | null = null;

    for (const [sessionId, entry] of this.pool) {
      if (entry.status !== 'idle') continue;
      if (oldest === null || entry.lastUsedAt < oldest.entry.lastUsedAt) {
        oldest = { sessionId, entry };
      }
    }

    if (oldest === null) return false;

    if (oldest.entry.idleTimer !== null) {
      clearTimeout(oldest.entry.idleTimer);
    }

    logger.info(
      { sessionId: oldest.sessionId, containerId: oldest.entry.containerId },
      'python-pool: LRU evicting idle container',
    );
    await this.stopAndRemove(oldest.sessionId, oldest.entry.containerId);
    return true;
  }

  // ---------------------------------------------------------------- //
  //  Per-session lock                                                 //
  // ---------------------------------------------------------------- //

  private async acquireLock(sessionId: string): Promise<void> {
    const deadline = Date.now() + 60_000; // 60 s timeout

    while (this.locks.has(sessionId)) {
      if (Date.now() > deadline) {
        logger.warn({ sessionId }, 'python-pool: lock timeout — forcibly acquiring');
        this.releaseLock(sessionId);
        break;
      }
      const lock = this.locks.get(sessionId);
      if (lock !== undefined) {
        await lock.promise;
      }
    }

    let resolve: (() => void) | undefined;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    this.locks.set(sessionId, { promise, resolve: resolve as () => void });
  }

  private releaseLock(sessionId: string): void {
    const lock = this.locks.get(sessionId);
    if (lock !== undefined) {
      this.locks.delete(sessionId);
      lock.resolve();
    }
  }
}
