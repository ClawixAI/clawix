import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBrowserTypeTool } from './browser-type.js';
import { BrowserSessionManager } from '../browser-session-manager.js';
import { BrowserProviderRegistry } from '../browser-provider-registry.js';
import { BrowserSessionSemaphore } from '../browser-session-semaphore.js';
import { MockBrowserProvider } from '../__tests__/mock-browser-provider.js';
import { stubRunContext } from '../__tests__/run-context-stub.js';
import type { RunContext } from './browser-navigate.js';

describe('browser_type', () => {
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

    const tool = createBrowserTypeTool(mgr, () => ctx);
    const result = await tool.execute({ text: 'hello' });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/ref is required/i);
  });

  it('rejects missing text parameter', async () => {
    const fakePage = { url: vi.fn(() => 'https://example.com') };
    const fakeContext = { pages: () => [fakePage], newPage: vi.fn() };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(fakeContext as any);

    mgr.setSnapshotRefs('r', new Map([['@e1', {}]]));

    const tool = createBrowserTypeTool(mgr, () => ctx);
    const result = await tool.execute({ ref: '@e1' });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/text is required/i);
  });

  it('rejects invalid ref format', async () => {
    const fakePage = { url: vi.fn(() => 'https://example.com') };
    const fakeContext = { pages: () => [fakePage], newPage: vi.fn() };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(fakeContext as any);

    const tool = createBrowserTypeTool(mgr, () => ctx);
    const result = await tool.execute({ ref: 'input-field', text: 'hello' });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/invalid ref/i);
  });

  it('rejects unknown ref against current refMap', async () => {
    const fakePage = { url: vi.fn(() => 'https://example.com') };
    const fakeContext = { pages: () => [fakePage], newPage: vi.fn() };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(fakeContext as any);

    mgr.setSnapshotRefs('r', new Map());

    const tool = createBrowserTypeTool(mgr, () => ctx);
    const result = await tool.execute({ ref: '@e5', text: 'hello' });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigate and snapshot first|unknown ref/i);
  });

  it('calls fill then pressSequentially when available', async () => {
    const fakeLocator = {
      fill: vi.fn(async () => undefined),
      pressSequentially: vi.fn(async () => undefined),
    };
    const fakePage = { url: vi.fn(() => 'https://example.com') };
    const fakeContext = { pages: () => [fakePage], newPage: vi.fn() };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(fakeContext as any);

    mgr.setSnapshotRefs('r', new Map([['@e1', fakeLocator]]));

    const tool = createBrowserTypeTool(mgr, () => ctx);
    const result = await tool.execute({ ref: '@e1', text: 'hello world' });

    expect(result.isError).toBe(false);
    expect(fakeLocator.fill).toHaveBeenCalledWith('');
    expect(fakeLocator.pressSequentially).toHaveBeenCalledWith('hello world', expect.any(Object));
    const parsed = JSON.parse(result.output) as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });

  it('falls back to type when pressSequentially is not available', async () => {
    const fakeLocator = {
      fill: vi.fn(async () => undefined),
      type: vi.fn(async () => undefined),
      // pressSequentially deliberately absent
    };
    const fakePage = { url: vi.fn(() => 'https://example.com') };
    const fakeContext = { pages: () => [fakePage], newPage: vi.fn() };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(fakeContext as any);

    mgr.setSnapshotRefs('r', new Map([['@e1', fakeLocator]]));

    const tool = createBrowserTypeTool(mgr, () => ctx);
    const result = await tool.execute({ ref: '@e1', text: 'fallback text' });

    expect(result.isError).toBe(false);
    expect(fakeLocator.fill).toHaveBeenCalledWith('');
    expect(fakeLocator.type).toHaveBeenCalledWith('fallback text', expect.any(Object));
    const parsed = JSON.parse(result.output) as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });

  it('returns navigate first when context is null', async () => {
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(null);

    const tool = createBrowserTypeTool(mgr, () => ctx);
    const result = await tool.execute({ ref: '@e1', text: 'hello' });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigate first/i);
  });
});
