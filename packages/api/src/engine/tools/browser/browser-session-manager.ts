import { Injectable } from '@nestjs/common';
import { createLogger } from '@clawix/shared';
import type { BrowserContext } from 'playwright-core';

import type { BrowserProvider, BrowserSession } from './browser-provider.js';
import { BrowserProviderRegistry } from './browser-provider-registry.js';
import { BrowserSessionSemaphore } from './browser-session-semaphore.js';
import { browserSessionsActive, browserSessionDuration } from './browser-metrics.js';

export interface ConsoleEntry {
  ts: number;
  type: string; // 'log' | 'warn' | 'error' | 'info' | 'debug' | etc.
  text: string;
}

export interface PendingDialog {
  ts: number;
  type: string; // 'alert' | 'confirm' | 'prompt' | 'beforeunload'
  message: string;
  resolve: (action: 'accept' | 'dismiss', text?: string) => Promise<void>;
}

interface PageWithListeners {
  on(event: 'console', listener: (msg: { type(): string; text(): string }) => void): unknown;
  on(
    event: 'dialog',
    listener: (dlg: {
      type(): string;
      message(): string;
      accept(text?: string): Promise<void>;
      dismiss(): Promise<void>;
    }) => void,
  ): unknown;
}

/**
 * Providers that hold a live Playwright BrowserContext expose it via getContext.
 * Cloud providers that only return a CDP URL (no in-process context) should
 * not implement this; the manager returns null in that case and tools fall
 * back to connecting via session.cdpUrl themselves (future work).
 */
export interface PlaywrightAwareProvider {
  getContext(runId: string): BrowserContext | null;
}

const logger = createLogger('engine:tools:browser:manager');

/** Opaque ref-map storage; the Locator type is defined where Playwright is imported. */
export type SnapshotRefMap = Map<string, unknown>;

export interface AgentRunSource {
  isRunning(runId: string): Promise<boolean>;
}

interface RunState {
  readonly userKey: string;
  readonly session: BrowserSession;
  /** Unix ms when the session was acquired — used for duration metrics. */
  readonly start: number;
  refMap: SnapshotRefMap;
  consoleBuffer: ConsoleEntry[];
  pendingDialogs: PendingDialog[];
  /** Page identities we've already attached listeners to. */
  listenerPages: WeakSet<object>;
}

export interface AcquireOptions {
  readonly runId: string;
  /** Key for the per-policy semaphore (typically user.id). */
  readonly userKey: string;
}

@Injectable()
export class BrowserSessionManager {
  private readonly runs = new Map<string, RunState>();
  /**
   * Per-runId in-flight acquisitions. Concurrent acquireForRun calls for the
   * same runId share the same promise, so the semaphore is only acquired
   * once and the provider gets one acquireSession call. Without this, two
   * parallel browser_* invocations in the same run could both pass the
   * `runs.get` existence check, both increment the semaphore, and leak quota
   * slots until process restart (review issue #6).
   */
  private readonly acquiring = new Map<string, Promise<BrowserSession>>();
  private agentRunSource: AgentRunSource | null = null;

  constructor(
    private readonly registry: BrowserProviderRegistry,
    private readonly sem: BrowserSessionSemaphore,
  ) {}

  /** Acquire (or return existing) session for a run. Idempotent for the same runId. */
  async acquireForRun(opts: AcquireOptions): Promise<BrowserSession> {
    const existing = this.runs.get(opts.runId);
    if (existing) return existing.session;

    const inFlight = this.acquiring.get(opts.runId);
    if (inFlight) return inFlight;

    const promise = this.doAcquire(opts).finally(() => {
      this.acquiring.delete(opts.runId);
    });
    this.acquiring.set(opts.runId, promise);
    return promise;
  }

  private async doAcquire(opts: AcquireOptions): Promise<BrowserSession> {
    const provider = this.activeProviderOrThrow();
    await this.sem.acquire(opts.userKey);
    try {
      const session = await provider.acquireSession(opts.runId);
      this.runs.set(opts.runId, {
        userKey: opts.userKey,
        session,
        start: Date.now(),
        refMap: new Map(),
        consoleBuffer: [],
        pendingDialogs: [],
        listenerPages: new WeakSet(),
      });
      browserSessionsActive.labels(session.providerName).inc();
      logger.info(
        { runId: opts.runId, provider: session.providerName },
        'browser session acquired',
      );
      return session;
    } catch (err) {
      this.sem.release(opts.userKey);
      throw err;
    }
  }

  /** Release the session if active. Never throws. */
  async releaseIfActive(runId: string): Promise<void> {
    const state = this.runs.get(runId);
    if (!state) return;
    this.runs.delete(runId);
    try {
      await this.activeProviderOrThrow().releaseSession(runId);
    } catch (err) {
      logger.warn({ runId, err }, 'provider releaseSession failed; continuing');
    } finally {
      browserSessionsActive.labels(state.session.providerName).dec();
      browserSessionDuration.observe(Date.now() - state.start);
      logger.info(
        { runId, provider: state.session.providerName, durationMs: Date.now() - state.start },
        'browser session released',
      );
      this.sem.release(state.userKey);
    }
  }

  setSnapshotRefs(runId: string, refs: SnapshotRefMap): void {
    const state = this.runs.get(runId);
    if (!state) return;
    state.refMap = refs;
  }

  getSnapshotRefs(runId: string): SnapshotRefMap | null {
    return this.runs.get(runId)?.refMap ?? null;
  }

  /** Returns a snapshot of active runs (for orphan-sweep tasks). */
  activeRunIds(): readonly string[] {
    return [...this.runs.keys()];
  }

  attachAgentRunSource(src: AgentRunSource): void {
    this.agentRunSource = src;
  }

  /**
   * Reconcile active runs against the agent-run source. Force-releases any run
   * whose record no longer reports running. No-op if no source is attached.
   */
  async sweepOrphans(): Promise<void> {
    const src = this.agentRunSource;
    if (!src) return;

    const ids = this.activeRunIds();
    for (const id of ids) {
      try {
        const stillRunning = await src.isRunning(id);
        if (!stillRunning) {
          logger.warn({ runId: id }, 'orphan browser session detected; releasing');
          await this.releaseIfActive(id);
        }
      } catch (err) {
        logger.warn({ runId: id, err }, 'orphan-sweep check failed; skipping');
      }
    }
  }

  /**
   * Idempotently attach console + dialog listeners to a Playwright page. Tools
   * call this with the page they're about to drive; subsequent calls for the
   * same page no-op.
   */
  attachPageListeners(runId: string, page: PageWithListeners): void {
    const state = this.runs.get(runId);
    if (!state) return;
    if (state.listenerPages.has(page as object)) return;
    state.listenerPages.add(page as object);

    page.on('console', (msg) => {
      state.consoleBuffer.push({
        ts: Date.now(),
        type: msg.type(),
        text: msg.text(),
      });
    });

    page.on('dialog', (dlg) => {
      const pending: PendingDialog = {
        ts: Date.now(),
        type: dlg.type(),
        message: dlg.message(),
        resolve: async (action, text) => {
          if (action === 'accept') await dlg.accept(text);
          else await dlg.dismiss();
        },
      };
      state.pendingDialogs.push(pending);
    });
  }

  drainConsole(runId: string, since?: number): ConsoleEntry[] {
    const state = this.runs.get(runId);
    if (!state) return [];
    const cutoff = since ?? 0;
    return state.consoleBuffer.filter((e) => e.ts > cutoff);
  }

  /** Returns the oldest pending dialog without removing it. */
  peekPendingDialog(runId: string): PendingDialog | null {
    return this.runs.get(runId)?.pendingDialogs[0] ?? null;
  }

  /** Removes the oldest pending dialog after it has been resolved. */
  shiftPendingDialog(runId: string): PendingDialog | null {
    const state = this.runs.get(runId);
    if (!state) return null;
    return state.pendingDialogs.shift() ?? null;
  }

  /** Returns the active provider's Playwright context for the run, if exposed. */
  getPlaywrightContext(runId: string): BrowserContext | null {
    const provider = this.registry.getActive() as Partial<PlaywrightAwareProvider> | null;
    if (!provider || typeof provider.getContext !== 'function') return null;
    return provider.getContext(runId);
  }

  private activeProviderOrThrow(): BrowserProvider {
    const p = this.registry.getActive();
    if (!p) throw new Error('no active BrowserProvider');
    return p;
  }
}
