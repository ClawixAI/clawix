import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBrowserScrollTool } from './browser-scroll.js';
import { BrowserSessionManager } from '../browser-session-manager.js';
import { BrowserProviderRegistry } from '../browser-provider-registry.js';
import { BrowserSessionSemaphore } from '../browser-session-semaphore.js';
import { MockBrowserProvider } from '../__tests__/mock-browser-provider.js';
import { stubRunContext } from '../__tests__/run-context-stub.js';
import type { RunContext } from './browser-navigate.js';

describe('browser_scroll', () => {
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

  it('returns validation error when direction is missing', async () => {
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [{}],
    } as any);

    const tool = createBrowserScrollTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/validation/i);
    expect(result.output).toMatch(/direction/i);
  });

  it('returns validation error for invalid direction', async () => {
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [{}],
    } as any);

    const tool = createBrowserScrollTool(mgr, () => ctx);
    const result = await tool.execute({ direction: 'diagonal' });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/validation/i);
    expect(result.output).toMatch(/direction/i);
  });

  it('returns navigate first when context is null', async () => {
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(null);

    const tool = createBrowserScrollTool(mgr, () => ctx);
    const result = await tool.execute({ direction: 'down' });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigate first/i);
  });

  it('returns navigate first when context has no pages', async () => {
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [],
    } as any);

    const tool = createBrowserScrollTool(mgr, () => ctx);
    const result = await tool.execute({ direction: 'down' });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigate first/i);
  });

  it('scrolls down with explicit amount calling page.evaluate with dy=500', async () => {
    const evaluateMock = vi.fn(async () => undefined);
    const fakePage = {
      evaluate: evaluateMock,
      viewportSize: vi.fn(() => ({ width: 1280, height: 800 })),
    };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [fakePage],
    } as any);

    const tool = createBrowserScrollTool(mgr, () => ctx);
    const result = await tool.execute({ direction: 'down', amount: 500 });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.output)).toMatchObject({ ok: true });
    expect(evaluateMock).toHaveBeenCalledOnce();
    // The first arg is the fn string/fn, second is the payload
    const callArgs = evaluateMock.mock.calls[0] as unknown[];
    expect(callArgs[1]).toEqual({ dx: 0, dy: 500 });
  });

  it('scrolls up with explicit amount calling page.evaluate with dy=-300', async () => {
    const evaluateMock = vi.fn(async () => undefined);
    const fakePage = {
      evaluate: evaluateMock,
      viewportSize: vi.fn(() => ({ width: 1280, height: 800 })),
    };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [fakePage],
    } as any);

    const tool = createBrowserScrollTool(mgr, () => ctx);
    const result = await tool.execute({ direction: 'up', amount: 300 });

    expect(result.isError).toBe(false);
    const callArgs = evaluateMock.mock.calls[0] as unknown[];
    expect(callArgs[1]).toEqual({ dx: 0, dy: -300 });
  });

  it('scrolls right with explicit amount calling page.evaluate with dx=400', async () => {
    const evaluateMock = vi.fn(async () => undefined);
    const fakePage = {
      evaluate: evaluateMock,
      viewportSize: vi.fn(() => ({ width: 1280, height: 800 })),
    };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [fakePage],
    } as any);

    const tool = createBrowserScrollTool(mgr, () => ctx);
    const result = await tool.execute({ direction: 'right', amount: 400 });

    expect(result.isError).toBe(false);
    const callArgs = evaluateMock.mock.calls[0] as unknown[];
    expect(callArgs[1]).toEqual({ dx: 400, dy: 0 });
  });

  it('uses viewport height as default amount for vertical scroll', async () => {
    const evaluateMock = vi.fn(async () => undefined);
    const fakePage = {
      evaluate: evaluateMock,
      viewportSize: vi.fn(() => ({ width: 1280, height: 900 })),
    };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [fakePage],
    } as any);

    const tool = createBrowserScrollTool(mgr, () => ctx);
    await tool.execute({ direction: 'down' });

    const callArgs = evaluateMock.mock.calls[0] as unknown[];
    expect(callArgs[1]).toEqual({ dx: 0, dy: 900 });
  });

  it('uses viewport width as default amount for horizontal scroll', async () => {
    const evaluateMock = vi.fn(async () => undefined);
    const fakePage = {
      evaluate: evaluateMock,
      viewportSize: vi.fn(() => ({ width: 1440, height: 900 })),
    };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [fakePage],
    } as any);

    const tool = createBrowserScrollTool(mgr, () => ctx);
    await tool.execute({ direction: 'left' });

    const callArgs = evaluateMock.mock.calls[0] as unknown[];
    expect(callArgs[1]).toEqual({ dx: -1440, dy: 0 });
  });

  it('falls back to defaults when viewportSize returns null', async () => {
    const evaluateMock = vi.fn(async () => undefined);
    const fakePage = {
      evaluate: evaluateMock,
      viewportSize: vi.fn(() => null),
    };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [fakePage],
    } as any);

    const tool = createBrowserScrollTool(mgr, () => ctx);
    await tool.execute({ direction: 'down' });

    const callArgs = evaluateMock.mock.calls[0] as unknown[];
    // Default vertical fallback is 800
    expect(callArgs[1]).toEqual({ dx: 0, dy: 800 });
  });
});
