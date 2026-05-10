import { describe, it, expect } from 'vitest';
import { MockBrowserProvider } from './mock-browser-provider.js';

describe('MockBrowserProvider', () => {
  it('returns the same session for the same runId (idempotent acquire)', async () => {
    const p = new MockBrowserProvider();

    const a = await p.acquireSession('run-1');
    const b = await p.acquireSession('run-1');

    expect(a.contextId).toBe(b.contextId);
    expect(a.cdpUrl).toBe(b.cdpUrl);
    expect(a.providerName).toBe('mock');
  });

  it('returns different sessions for different runs', async () => {
    const p = new MockBrowserProvider();

    const a = await p.acquireSession('run-1');
    const b = await p.acquireSession('run-2');

    expect(a.contextId).not.toBe(b.contextId);
  });

  it('release is idempotent and never throws', async () => {
    const p = new MockBrowserProvider();
    await p.acquireSession('run-1');

    await expect(p.releaseSession('run-1')).resolves.not.toThrow();
    await expect(p.releaseSession('run-1')).resolves.not.toThrow();
    await expect(p.releaseSession('does-not-exist')).resolves.not.toThrow();
  });

  it('exposes a hook for tests to record calls', async () => {
    const p = new MockBrowserProvider();
    await p.acquireSession('run-1');
    await p.releaseSession('run-1');

    expect(p.calls).toEqual([
      { op: 'acquire', runId: 'run-1' },
      { op: 'release', runId: 'run-1' },
    ]);
  });
});
