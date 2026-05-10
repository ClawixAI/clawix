import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserVisionTool } from './browser-vision.js';
import { BrowserProviderRegistry } from '../browser-provider-registry.js';
import { BrowserSessionManager } from '../browser-session-manager.js';
import { BrowserSessionSemaphore } from '../browser-session-semaphore.js';
import { MockBrowserProvider } from '../__tests__/mock-browser-provider.js';
import { stubRunContext } from '../__tests__/run-context-stub.js';

describe('browser_vision', () => {
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

  it('calls vision.call with the screenshot and prompt when vision is available + capable', async () => {
    const call = vi.fn(async () => 'vision-response');
    const ctx = stubRunContext({
      vision: {
        available: true,
        capable: true,
        providerLabel: 'anthropic',
        modelLabel: 'claude-sonnet-4',
        call,
      },
    });

    const fakePage = { screenshot: vi.fn(async () => Buffer.from('fake-png')) };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({ pages: () => [fakePage] } as never);

    const tool = createBrowserVisionTool(mgr, () => ctx);
    const result = await tool.execute({ prompt: 'What do you see?' });

    expect(result.isError).toBe(false);
    expect(result.output).toBe('vision-response');
    expect(call).toHaveBeenCalledWith(expect.any(Buffer), 'What do you see?');
  });

  it('uses the default prompt when one is not supplied', async () => {
    const call = vi.fn(async () => 'default-response');
    const ctx = stubRunContext({
      vision: {
        available: true,
        capable: true,
        providerLabel: 'openai',
        modelLabel: 'gpt-4o',
        call,
      },
    });

    const fakePage = { screenshot: vi.fn(async () => Buffer.from('fake-png')) };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({ pages: () => [fakePage] } as never);

    const tool = createBrowserVisionTool(mgr, () => ctx);
    await tool.execute({});

    expect(call).toHaveBeenCalledWith(expect.any(Buffer), expect.stringContaining('Describe'));
  });

  it('errors with the resolution reason when vision is unavailable (delegate not found, etc.)', async () => {
    const ctx = stubRunContext({
      vision: { available: false, reason: 'delegate agent "agent:bogus-id" not found' },
    });

    const tool = createBrowserVisionTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.output).toContain('delegate agent');
  });

  it('errors when the resolved model is not vision-capable', async () => {
    const ctx = stubRunContext({
      vision: {
        available: true,
        capable: false,
        providerLabel: 'openai',
        modelLabel: 'gpt-3.5-turbo',
        call: vi.fn(),
      },
    });

    const fakePage = { screenshot: vi.fn(async () => Buffer.from('fake-png')) };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({ pages: () => [fakePage] } as never);

    const tool = createBrowserVisionTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.output).toContain('gpt-3.5-turbo');
    expect(result.output).toMatch(/not known to support image input/i);
  });

  it('returns navigate-first when context is null', async () => {
    const ctx = stubRunContext({
      vision: {
        available: true,
        capable: true,
        providerLabel: 'anthropic',
        modelLabel: 'claude-sonnet-4',
        call: vi.fn(),
      },
    });
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(null);

    const tool = createBrowserVisionTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigate first/i);
  });

  it('returns navigate-first when context has no pages', async () => {
    const ctx = stubRunContext({
      vision: {
        available: true,
        capable: true,
        providerLabel: 'anthropic',
        modelLabel: 'claude-sonnet-4',
        call: vi.fn(),
      },
    });
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({ pages: () => [] } as never);

    const tool = createBrowserVisionTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigate first/i);
  });
});
