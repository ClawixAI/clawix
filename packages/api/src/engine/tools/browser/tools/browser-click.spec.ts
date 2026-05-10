import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBrowserClickTool } from './browser-click.js';
import { BrowserSessionManager } from '../browser-session-manager.js';
import { BrowserProviderRegistry } from '../browser-provider-registry.js';
import { BrowserSessionSemaphore } from '../browser-session-semaphore.js';
import { MockBrowserProvider } from '../__tests__/mock-browser-provider.js';
import { stubRunContext } from '../__tests__/run-context-stub.js';
import type { RunContext } from './browser-navigate.js';

describe('browser_click', () => {
  let mgr: BrowserSessionManager;
  let provider: MockBrowserProvider;
  let ctx: RunContext;

  beforeEach(async () => {
    provider = new MockBrowserProvider();
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

  it('rejects missing ref parameter', async () => {
    const fakePage = { url: vi.fn(() => 'https://example.com') };
    const fakeContext = { pages: () => [fakePage], newPage: vi.fn() };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(fakeContext as any);

    const tool = createBrowserClickTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/ref is required/i);
  });

  it('rejects invalid ref format', async () => {
    const fakePage = { url: vi.fn(() => 'https://example.com') };
    const fakeContext = { pages: () => [fakePage], newPage: vi.fn() };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(fakeContext as any);

    const tool = createBrowserClickTool(mgr, () => ctx);
    const result = await tool.execute({ ref: 'button-1' });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/invalid ref/i);
  });

  it('rejects unknown ref when refMap is empty', async () => {
    const fakePage = { url: vi.fn(() => 'https://example.com') };
    const fakeContext = { pages: () => [fakePage], newPage: vi.fn() };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(fakeContext as any);

    // Ensure empty refMap (no snapshot taken)
    mgr.setSnapshotRefs('r', new Map());

    const tool = createBrowserClickTool(mgr, () => ctx);
    const result = await tool.execute({ ref: '@e1' });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigate and snapshot first|unknown ref/i);
  });

  it('rejects unknown ref when refMap does not contain the ref', async () => {
    const fakePage = { url: vi.fn(() => 'https://example.com') };
    const fakeContext = { pages: () => [fakePage], newPage: vi.fn() };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(fakeContext as any);

    // Set refMap with a different ref
    const existingLocator = { click: vi.fn(async () => undefined) };
    mgr.setSnapshotRefs('r', new Map([['@e1', existingLocator]]));

    const tool = createBrowserClickTool(mgr, () => ctx);
    const result = await tool.execute({ ref: '@e99' });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/unknown ref/i);
  });

  it('calls click on the resolved locator and returns newUrl', async () => {
    const fakeLocator = { click: vi.fn(async () => undefined) };
    const fakePage = { url: vi.fn(() => 'https://x.com/after-click') };
    const fakeContext = { pages: () => [fakePage], newPage: vi.fn() };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(fakeContext as any);

    mgr.setSnapshotRefs('r', new Map([['@e1', fakeLocator]]));

    const tool = createBrowserClickTool(mgr, () => ctx);
    const result = await tool.execute({ ref: '@e1' });

    expect(result.isError).toBe(false);
    expect(fakeLocator.click).toHaveBeenCalled();
    const parsed = JSON.parse(result.output) as { ok: boolean; newUrl: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.newUrl).toBe('https://x.com/after-click');
  });

  it('returns navigate first when context is null', async () => {
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(null);

    const tool = createBrowserClickTool(mgr, () => ctx);
    const result = await tool.execute({ ref: '@e1' });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigate first/i);
  });
});
