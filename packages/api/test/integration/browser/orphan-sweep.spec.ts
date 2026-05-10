/**
 * Integration test — BrowserSessionManager.sweepOrphans() with the real sidecar.
 *
 * Gate: only runs when INTEGRATION=true is set.
 *
 * This test uses an in-memory AgentRunSource stub in place of a real Postgres
 * AgentRun row. The full DB-backed variant (write AgentRun status → sweep) is
 * deferred until integration-test DB plumbing is added (see the project's
 * test-db conventions). This version still exercises the integration between
 * the real Chromium sidecar, BrowserSessionManager, and the semaphore: it
 * verifies that a session opened against live Chromium is properly torn down
 * when sweepOrphans detects the run is no longer active.
 *
 * Requires:
 *   BROWSER_AUTH_TOKEN   — must match the value passed to the sidecar's TOKEN env var
 *   BROWSER_SIDECAR_URL  — WebSocket URL for the sidecar (default: ws://localhost:3001)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupBrowserIntegration, teardownBrowserIntegration } from './setup.js';
import { LocalProvider } from '../../../src/engine/tools/browser/providers/local-provider.js';
import { BrowserProviderRegistry } from '../../../src/engine/tools/browser/browser-provider-registry.js';
import { BrowserSessionSemaphore } from '../../../src/engine/tools/browser/browser-session-semaphore.js';
import {
  BrowserSessionManager,
  type AgentRunSource,
} from '../../../src/engine/tools/browser/browser-session-manager.js';

const INTEGRATION = process.env['INTEGRATION'] === 'true';

beforeAll(async () => {
  if (!INTEGRATION) return;
  await setupBrowserIntegration();
}, 90_000);

afterAll(async () => {
  if (!INTEGRATION) return;
  await teardownBrowserIntegration();
});

describe.skipIf(!INTEGRATION)('BrowserSessionManager.sweepOrphans (integration)', () => {
  function buildManager(): BrowserSessionManager {
    process.env['BROWSER_PROVIDER'] = 'local';
    process.env['BROWSER_SIDECAR_URL'] =
      process.env['BROWSER_SIDECAR_URL'] ?? 'ws://localhost:3001';
    process.env['BROWSER_AUTH_TOKEN'] = process.env['BROWSER_AUTH_TOKEN'] ?? 'test-token';

    const provider = new LocalProvider();
    const registry = new BrowserProviderRegistry();
    registry.register(provider);
    registry.activate();

    const sem = new BrowserSessionSemaphore({ getQuota: () => 5, queueTimeoutMs: 15_000 });
    return new BrowserSessionManager(registry, sem);
  }

  it('releases an orphaned session against the real sidecar', async () => {
    const mgr = buildManager();

    // Start with the run "active".
    const orphan = false;
    const fakeSource: AgentRunSource = {
      isRunning: async (_runId: string) => !orphan,
    };
    mgr.attachAgentRunSource(fakeSource);

    // Acquire a real browser session from the live sidecar.
    await mgr.acquireForRun({ runId: 'sweep-r1', userKey: 'sweep-u' });
    expect(mgr.activeRunIds()).toContain('sweep-r1');

    // Semaphore should hold one slot.
    // (we read the count before the sweep — the sem lives outside of mgr in
    //  the test so we can compare before/after by keeping a reference)
    const semRef = new BrowserSessionSemaphore({
      getQuota: () => 5,
      queueTimeoutMs: 15_000,
    });
    // Rebuild manager with the ref semaphore so we can inspect activeCount.
    const provider2 = new LocalProvider();
    const registry2 = new BrowserProviderRegistry();
    registry2.register(provider2);
    registry2.activate();
    const mgr2 = new BrowserSessionManager(registry2, semRef);
    let orphan2 = false;
    mgr2.attachAgentRunSource({ isRunning: async () => !orphan2 });

    await mgr2.acquireForRun({ runId: 'sweep-r2', userKey: 'sweep-u2' });
    expect(mgr2.activeRunIds()).toContain('sweep-r2');
    expect(semRef.activeCount('sweep-u2')).toBe(1);

    // Mark the run as finished and sweep.
    orphan2 = true;
    await mgr2.sweepOrphans();

    expect(mgr2.activeRunIds()).not.toContain('sweep-r2');
    expect(semRef.activeCount('sweep-u2')).toBe(0);

    // Clean up the first manager's session too.
    await mgr.releaseIfActive('sweep-r1');
  }, 60_000);

  it('does nothing when all runs are still active', async () => {
    const mgr = buildManager();
    mgr.attachAgentRunSource({ isRunning: async () => true });

    await mgr.acquireForRun({ runId: 'sweep-active', userKey: 'sweep-u3' });
    expect(mgr.activeRunIds()).toContain('sweep-active');

    await mgr.sweepOrphans();

    // Run should still be present — it was reported as running.
    expect(mgr.activeRunIds()).toContain('sweep-active');

    // Cleanup.
    await mgr.releaseIfActive('sweep-active');
  }, 60_000);
});
