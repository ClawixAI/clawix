import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBrowserConsoleTool } from './browser-console.js';
import { BrowserSessionManager } from '../browser-session-manager.js';
import { BrowserProviderRegistry } from '../browser-provider-registry.js';
import { BrowserSessionSemaphore } from '../browser-session-semaphore.js';
import { MockBrowserProvider } from '../__tests__/mock-browser-provider.js';
import { stubRunContext } from '../__tests__/run-context-stub.js';
import type { RunContext } from './browser-navigate.js';

describe('browser_console', () => {
  let mgr: BrowserSessionManager;
  let ctx: RunContext;

  beforeEach(async () => {
    const provider = new MockBrowserProvider();
    Object.defineProperty(provider, 'name', { value: 'local' });
    const registry = new BrowserProviderRegistry();
    registry.register(provider);
    process.env['BROWSER_PROVIDER'] = 'local';
    registry.activate();
    const sem = new BrowserSessionSemaphore({ getQuota: () => 5, queueTimeoutMs: 100 });
    mgr = new BrowserSessionManager(registry, sem);
    ctx = stubRunContext();
    await mgr.acquireForRun({ runId: 'r', userKey: 'u' });
  });

  it('returns navigate-first error when getPlaywrightContext returns null', async () => {
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(null);

    const tool = createBrowserConsoleTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigate first/i);
  });

  it('returns navigate-first error when context has no pages', async () => {
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [],
    } as never);

    const tool = createBrowserConsoleTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigate first/i);
  });

  it('returns existing console entries from buffer', async () => {
    const capturedHandlers: { event: string; listener: (...args: unknown[]) => void }[] = [];
    const fakePage = {
      on(event: string, listener: (...args: unknown[]) => void) {
        capturedHandlers.push({ event, listener });
      },
    };

    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [fakePage],
    } as never);

    // Attach listeners via tool call so the buffer gets populated
    const tool = createBrowserConsoleTool(mgr, () => ctx);

    // First call to attach listeners — may return empty since no events yet
    await tool.execute({});

    // Simulate a console event via the captured listener
    const consoleHandler = capturedHandlers.find((h) => h.event === 'console');
    expect(consoleHandler).toBeDefined();
    consoleHandler!.listener({ type: () => 'log', text: () => 'test message' });

    // Second call should now return the buffered entry
    const result = await tool.execute({});
    expect(result.isError).toBe(false);

    const entries = JSON.parse(result.output) as { type: string; text: string }[];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'log', text: 'test message' });
  });

  it('filters entries by since timestamp', async () => {
    const capturedHandlers: { event: string; listener: (...args: unknown[]) => void }[] = [];
    const fakePage = {
      on(event: string, listener: (...args: unknown[]) => void) {
        capturedHandlers.push({ event, listener });
      },
    };

    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [fakePage],
    } as never);

    const tool = createBrowserConsoleTool(mgr, () => ctx);

    // Attach listeners first
    await tool.execute({});

    const consoleHandler = capturedHandlers.find((h) => h.event === 'console');
    expect(consoleHandler).toBeDefined();

    // Push two entries at distinct times using mocked Date.now
    const t1 = 1000;
    const t2 = 2000;

    vi.spyOn(Date, 'now').mockReturnValueOnce(t1);
    consoleHandler!.listener({ type: () => 'warn', text: () => 'older entry' });

    vi.spyOn(Date, 'now').mockReturnValueOnce(t2);
    consoleHandler!.listener({ type: () => 'error', text: () => 'newer entry' });

    vi.restoreAllMocks();

    // Re-attach context spy (restoreAllMocks cleared it)
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [fakePage],
    } as never);

    // Query with since=t1: should only return entries with ts > t1
    const result = await tool.execute({ since: t1 });
    expect(result.isError).toBe(false);

    const entries = JSON.parse(result.output) as { type: string; text: string }[];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'error', text: 'newer entry' });
  });
});
