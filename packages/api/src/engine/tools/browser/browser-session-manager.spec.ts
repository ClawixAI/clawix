import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BrowserSessionManager } from './browser-session-manager.js';
import { BrowserProviderRegistry } from './browser-provider-registry.js';
import { BrowserSessionSemaphore } from './browser-session-semaphore.js';
import { MockBrowserProvider } from './__tests__/mock-browser-provider.js';

describe('BrowserSessionManager', () => {
  let provider: MockBrowserProvider;
  let registry: BrowserProviderRegistry;
  let sem: BrowserSessionSemaphore;
  let mgr: BrowserSessionManager;

  beforeEach(() => {
    provider = new MockBrowserProvider();
    Object.defineProperty(provider, 'name', { value: 'local' });
    registry = new BrowserProviderRegistry();
    registry.register(provider);
    process.env['BROWSER_PROVIDER'] = 'local';
    registry.activate();
    sem = new BrowserSessionSemaphore({ getQuota: () => 5, queueTimeoutMs: 100 });
    mgr = new BrowserSessionManager(registry, sem);
  });

  it('lazily acquires a session on first call for a run', async () => {
    const session = await mgr.acquireForRun({ runId: 'r1', userKey: 'user-1' });
    expect(session.contextId).toBeDefined();
    expect(provider.calls).toContainEqual({ op: 'acquire', runId: 'r1' });
  });

  it('returns the same session on subsequent calls in the same run', async () => {
    const a = await mgr.acquireForRun({ runId: 'r1', userKey: 'user-1' });
    const b = await mgr.acquireForRun({ runId: 'r1', userKey: 'user-1' });
    expect(a.contextId).toBe(b.contextId);
    expect(provider.calls.filter((c) => c.op === 'acquire')).toHaveLength(1);
  });

  it('coalesces concurrent acquireForRun calls for the same runId (no semaphore leak)', async () => {
    // Two parallel browser_* calls in the same run must share one acquisition
    // — otherwise the per-user semaphore counter is incremented twice and
    // only decremented once at release, leaking a quota slot until restart.
    const [a, b, c] = await Promise.all([
      mgr.acquireForRun({ runId: 'r1', userKey: 'user-1' }),
      mgr.acquireForRun({ runId: 'r1', userKey: 'user-1' }),
      mgr.acquireForRun({ runId: 'r1', userKey: 'user-1' }),
    ]);

    expect(a.contextId).toBe(b.contextId);
    expect(b.contextId).toBe(c.contextId);
    expect(provider.calls.filter((op) => op.op === 'acquire')).toHaveLength(1);
    expect(sem.activeCount('user-1')).toBe(1);

    await mgr.releaseIfActive('r1');
    expect(sem.activeCount('user-1')).toBe(0);
  });

  it('releaseIfActive releases the provider session and the semaphore', async () => {
    await mgr.acquireForRun({ runId: 'r1', userKey: 'user-1' });
    await mgr.releaseIfActive('r1');
    expect(provider.calls).toContainEqual({ op: 'release', runId: 'r1' });
    expect(sem.activeCount('user-1')).toBe(0);
  });

  it('releaseIfActive is idempotent and silent on unknown runId', async () => {
    await expect(mgr.releaseIfActive('does-not-exist')).resolves.not.toThrow();
  });

  it('refMap is per-run and replaced by setSnapshotRefs', async () => {
    await mgr.acquireForRun({ runId: 'r1', userKey: 'user-1' });
    mgr.setSnapshotRefs('r1', new Map([['@e1', { fakeLocator: 1 } as unknown]]));

    const refs = mgr.getSnapshotRefs('r1');
    expect(refs?.get('@e1')).toEqual({ fakeLocator: 1 });

    mgr.setSnapshotRefs('r1', new Map([['@e2', { fakeLocator: 2 } as unknown]]));
    expect(mgr.getSnapshotRefs('r1')?.get('@e1')).toBeUndefined();
    expect(mgr.getSnapshotRefs('r1')?.get('@e2')).toEqual({ fakeLocator: 2 });
  });
});

describe('BrowserSessionManager — orphan sweep', () => {
  it('releases sessions for runs that are no longer running per the agent-run repo', async () => {
    const provider = new MockBrowserProvider();
    Object.defineProperty(provider, 'name', { value: 'local' });
    const registry = new BrowserProviderRegistry();
    registry.register(provider);
    process.env['BROWSER_PROVIDER'] = 'local';
    registry.activate();
    const sem = new BrowserSessionSemaphore({ getQuota: () => 5, queueTimeoutMs: 100 });

    const repo = {
      isRunning: vi.fn(async (id: string) => id === 'r1'),
    };

    const mgr = new BrowserSessionManager(registry, sem);
    mgr.attachAgentRunSource(repo);

    await mgr.acquireForRun({ runId: 'r1', userKey: 'u' });
    await mgr.acquireForRun({ runId: 'r2', userKey: 'u' });

    await mgr.sweepOrphans();

    expect(mgr.activeRunIds()).toEqual(['r1']);
    expect(provider.calls).toContainEqual({ op: 'release', runId: 'r2' });
    expect(provider.calls).not.toContainEqual({ op: 'release', runId: 'r1' });
  });
});

describe('BrowserSessionManager — page listeners', () => {
  it('attachPageListeners is idempotent and forwards console + dialog events', async () => {
    const provider = new MockBrowserProvider();
    Object.defineProperty(provider, 'name', { value: 'local' });
    const registry = new BrowserProviderRegistry();
    registry.register(provider);
    process.env['BROWSER_PROVIDER'] = 'local';
    registry.activate();
    const sem = new BrowserSessionSemaphore({ getQuota: () => 5, queueTimeoutMs: 100 });
    const mgr = new BrowserSessionManager(registry, sem);
    await mgr.acquireForRun({ runId: 'r', userKey: 'u' });

    const handlers: { event: string; listener: (...args: unknown[]) => void }[] = [];
    const fakePage = {
      on(event: string, listener: (...args: unknown[]) => void) {
        handlers.push({ event, listener });
      },
    };

    mgr.attachPageListeners('r', fakePage as never);
    mgr.attachPageListeners('r', fakePage as never); // idempotent — second call no-op

    expect(handlers.filter((h) => h.event === 'console')).toHaveLength(1);
    expect(handlers.filter((h) => h.event === 'dialog')).toHaveLength(1);

    // Simulate a console event
    handlers
      .find((h) => h.event === 'console')!
      .listener({
        type: () => 'warn',
        text: () => 'hello',
      });
    expect(mgr.drainConsole('r')).toEqual([
      expect.objectContaining({ type: 'warn', text: 'hello' }),
    ]);

    // Simulate a dialog
    handlers
      .find((h) => h.event === 'dialog')!
      .listener({
        type: () => 'confirm',
        message: () => 'sure?',
        accept: async () => {},
        dismiss: async () => {},
      });
    const pending = mgr.peekPendingDialog('r');
    expect(pending?.type).toBe('confirm');
    expect(pending?.message).toBe('sure?');
  });
});
