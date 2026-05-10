import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBrowserCdpTool } from './browser-cdp.js';
import { BrowserSessionManager } from '../browser-session-manager.js';
import { BrowserProviderRegistry } from '../browser-provider-registry.js';
import { BrowserSessionSemaphore } from '../browser-session-semaphore.js';
import { MockBrowserProvider } from '../__tests__/mock-browser-provider.js';
import { stubRunContext } from '../__tests__/run-context-stub.js';

describe('browser_cdp', () => {
  let mgr: BrowserSessionManager;

  beforeEach(async () => {
    const provider = new MockBrowserProvider();
    Object.defineProperty(provider, 'name', { value: 'local' });
    const registry = new BrowserProviderRegistry();
    registry.register(provider);
    process.env['BROWSER_PROVIDER'] = 'local';
    registry.activate();
    const sem = new BrowserSessionSemaphore({ getQuota: () => 5, queueTimeoutMs: 100 });
    mgr = new BrowserSessionManager(registry, sem);
    await mgr.acquireForRun({ runId: 'r', userKey: 'u' });
  });

  it('rejects when policy.allowBrowserCdp is false', async () => {
    const ctx = stubRunContext({ policy: { allowBrowserCdp: false } });

    const tool = createBrowserCdpTool(mgr, () => ctx);
    const result = await tool.execute({ method: 'Page.reload' });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/CDP access/i);
  });

  it('runs the CDP command when policy allows', async () => {
    const ctx = stubRunContext({ policy: { allowBrowserCdp: true } });

    const cdpSend = vi.fn(async () => ({ ok: true }));
    const cdpDetach = vi.fn(async () => undefined);
    const fakeCdpSession = { send: cdpSend, detach: cdpDetach };
    const fakePageContext = {
      newCDPSession: vi.fn(async () => fakeCdpSession),
    };
    const fakePage = {
      context: vi.fn(() => fakePageContext),
    };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [fakePage],
    } as any);

    const tool = createBrowserCdpTool(mgr, () => ctx);
    const result = await tool.execute({ method: 'Page.reload' });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.output)).toEqual({ ok: true });
    expect(cdpSend).toHaveBeenCalledWith('Page.reload', undefined);
    expect(cdpDetach).toHaveBeenCalledOnce();
  });

  it('validates URL on Page.navigate with private address', async () => {
    const ctx = stubRunContext({ policy: { allowBrowserCdp: true } });

    const cdpSend = vi.fn(async () => ({}));
    const cdpDetach = vi.fn(async () => undefined);
    const fakeCdpSession = { send: cdpSend, detach: cdpDetach };
    const fakePageContext = {
      newCDPSession: vi.fn(async () => fakeCdpSession),
    };
    const fakePage = {
      context: vi.fn(() => fakePageContext),
    };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [fakePage],
    } as any);

    const tool = createBrowserCdpTool(mgr, () => ctx);
    const result = await tool.execute({
      method: 'Page.navigate',
      params: { url: 'http://127.0.0.1:5432/' },
    });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/validation/i);
    // cdpSend should NOT have been called
    expect(cdpSend).not.toHaveBeenCalled();
  });

  it('returns navigate first when context is null', async () => {
    const ctx = stubRunContext({ policy: { allowBrowserCdp: true } });
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(null);

    const tool = createBrowserCdpTool(mgr, () => ctx);
    const result = await tool.execute({ method: 'Page.reload' });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigate first/i);
  });

  it('returns navigate first when context has no pages', async () => {
    const ctx = stubRunContext({ policy: { allowBrowserCdp: true } });
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [],
    } as any);

    const tool = createBrowserCdpTool(mgr, () => ctx);
    const result = await tool.execute({ method: 'Page.reload' });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigate first/i);
  });

  it('rejects missing method parameter', async () => {
    const ctx = stubRunContext({ policy: { allowBrowserCdp: true } });

    const tool = createBrowserCdpTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/method is required/i);
  });
});
