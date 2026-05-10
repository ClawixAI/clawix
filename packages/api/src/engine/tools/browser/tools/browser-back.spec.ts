import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBrowserBackTool } from './browser-back.js';
import { BrowserSessionManager } from '../browser-session-manager.js';
import { BrowserProviderRegistry } from '../browser-provider-registry.js';
import { BrowserSessionSemaphore } from '../browser-session-semaphore.js';
import { MockBrowserProvider } from '../__tests__/mock-browser-provider.js';
import { stubRunContext } from '../__tests__/run-context-stub.js';
import type { RunContext } from './browser-navigate.js';

describe('browser_back', () => {
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

  it('returns navigate first when context is null', async () => {
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(null);

    const tool = createBrowserBackTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigate first/i);
  });

  it('returns navigate first when context has no pages', async () => {
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [],
    } as any);

    const tool = createBrowserBackTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigate first/i);
  });

  it('navigates back and returns previous url on success', async () => {
    const previousUrl = 'https://example.com/previous';
    const fakePage = {
      goBack: vi.fn(async () => ({ status: () => 200 })),
      url: vi.fn(() => previousUrl),
    };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [fakePage],
    } as any);

    const tool = createBrowserBackTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.output) as { url: string };
    expect(parsed.url).toBe(previousUrl);
    expect(fakePage.goBack).toHaveBeenCalledOnce();
  });

  it('returns current url when goBack returns null (no history)', async () => {
    const currentUrl = 'https://example.com/first';
    const fakePage = {
      goBack: vi.fn(async () => null),
      url: vi.fn(() => currentUrl),
    };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [fakePage],
    } as any);

    const tool = createBrowserBackTool(mgr, () => ctx);
    const result = await tool.execute({});

    // No error — just returns the current URL
    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.output) as { url: string };
    expect(parsed.url).toBe(currentUrl);
  });

  it('returns error when goBack throws', async () => {
    const fakePage = {
      goBack: vi.fn(async () => {
        throw new Error('navigation timeout');
      }),
      url: vi.fn(() => 'https://example.com'),
    };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [fakePage],
    } as any);

    const tool = createBrowserBackTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigation timeout/i);
  });
});
