import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBrowserGetImagesTool } from './browser-get-images.js';
import { BrowserSessionManager } from '../browser-session-manager.js';
import { BrowserProviderRegistry } from '../browser-provider-registry.js';
import { BrowserSessionSemaphore } from '../browser-session-semaphore.js';
import { MockBrowserProvider } from '../__tests__/mock-browser-provider.js';
import { stubRunContext } from '../__tests__/run-context-stub.js';
import type { RunContext } from './browser-navigate.js';

describe('browser_get_images', () => {
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

    const tool = createBrowserGetImagesTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigate first/i);
  });

  it('returns navigate first when context has no pages', async () => {
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [],
    } as any);

    const tool = createBrowserGetImagesTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigate first/i);
  });

  it('returns json array of images with url and alt', async () => {
    const images = [
      { url: 'https://example.com/a.png', alt: 'Image A' },
      { url: 'https://example.com/b.png', alt: '' },
    ];
    const fakePage = {
      evaluate: vi.fn(async () => images),
    };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [fakePage],
    } as any);

    const tool = createBrowserGetImagesTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.output) as { url: string; alt: string }[];
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ url: 'https://example.com/a.png', alt: 'Image A' });
    expect(parsed[1]).toEqual({ url: 'https://example.com/b.png', alt: '' });
  });

  it('returns empty array when page has no images', async () => {
    const fakePage = {
      evaluate: vi.fn(async () => []),
    };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [fakePage],
    } as any);

    const tool = createBrowserGetImagesTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(false);
    expect(result.output).toBe('[]');
  });

  it('returns error when evaluate throws', async () => {
    const fakePage = {
      evaluate: vi.fn(async () => {
        throw new Error('evaluate failed');
      }),
    };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [fakePage],
    } as any);

    const tool = createBrowserGetImagesTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/evaluate failed/i);
  });
});
