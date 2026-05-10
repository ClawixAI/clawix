import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBrowserPressTool } from './browser-press.js';
import { BrowserSessionManager } from '../browser-session-manager.js';
import { BrowserProviderRegistry } from '../browser-provider-registry.js';
import { BrowserSessionSemaphore } from '../browser-session-semaphore.js';
import { MockBrowserProvider } from '../__tests__/mock-browser-provider.js';
import { stubRunContext } from '../__tests__/run-context-stub.js';
import type { RunContext } from './browser-navigate.js';

describe('browser_press', () => {
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

  it('rejects missing key parameter', async () => {
    const fakeKeyboard = { press: vi.fn(async () => undefined) };
    const fakePage = { keyboard: fakeKeyboard };
    const fakeContext = { pages: () => [fakePage], newPage: vi.fn() };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(fakeContext as any);

    const tool = createBrowserPressTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/key is required/i);
  });

  it('returns navigate first when context is null', async () => {
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(null);

    const tool = createBrowserPressTool(mgr, () => ctx);
    const result = await tool.execute({ key: 'Enter' });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigate first/i);
  });

  it('returns navigate first when context has no pages', async () => {
    const fakeContext = { pages: () => [], newPage: vi.fn() };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(fakeContext as any);

    const tool = createBrowserPressTool(mgr, () => ctx);
    const result = await tool.execute({ key: 'Enter' });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigate first/i);
  });

  it('calls keyboard.press with Enter key and returns ok', async () => {
    const fakeKeyboard = { press: vi.fn(async () => undefined) };
    const fakePage = { keyboard: fakeKeyboard };
    const fakeContext = { pages: () => [fakePage], newPage: vi.fn() };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(fakeContext as any);

    const tool = createBrowserPressTool(mgr, () => ctx);
    const result = await tool.execute({ key: 'Enter' });

    expect(result.isError).toBe(false);
    expect(fakeKeyboard.press).toHaveBeenCalledWith('Enter');
    const parsed = JSON.parse(result.output) as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });

  it('calls keyboard.press with Tab key', async () => {
    const fakeKeyboard = { press: vi.fn(async () => undefined) };
    const fakePage = { keyboard: fakeKeyboard };
    const fakeContext = { pages: () => [fakePage], newPage: vi.fn() };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(fakeContext as any);

    const tool = createBrowserPressTool(mgr, () => ctx);
    const result = await tool.execute({ key: 'Tab' });

    expect(result.isError).toBe(false);
    expect(fakeKeyboard.press).toHaveBeenCalledWith('Tab');
  });

  it('calls keyboard.press with Escape key', async () => {
    const fakeKeyboard = { press: vi.fn(async () => undefined) };
    const fakePage = { keyboard: fakeKeyboard };
    const fakeContext = { pages: () => [fakePage], newPage: vi.fn() };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(fakeContext as any);

    const tool = createBrowserPressTool(mgr, () => ctx);
    const result = await tool.execute({ key: 'Escape' });

    expect(result.isError).toBe(false);
    expect(fakeKeyboard.press).toHaveBeenCalledWith('Escape');
  });
});
