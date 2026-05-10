import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('playwright-core', () => ({
  chromium: {
    connect: vi.fn(),
  },
}));

import { chromium } from 'playwright-core';
import { CdpProvider } from './cdp-provider.js';
import { BrowserProviderConfigError } from '../browser-provider.js';

describe('CdpProvider', () => {
  const ORIGINAL_CDP_URL = process.env['BROWSER_CDP_URL'];

  beforeEach(() => {
    process.env['BROWSER_CDP_URL'] = 'ws://my-chrome:9222';
  });

  afterEach(() => {
    if (ORIGINAL_CDP_URL === undefined) delete process.env['BROWSER_CDP_URL'];
    else process.env['BROWSER_CDP_URL'] = ORIGINAL_CDP_URL;
    vi.clearAllMocks();
  });

  it('throws config error if BROWSER_CDP_URL is missing', () => {
    delete process.env['BROWSER_CDP_URL'];
    expect(() => new CdpProvider()).toThrow(BrowserProviderConfigError);
    expect(() => new CdpProvider()).toThrow(/BROWSER_CDP_URL/);
  });

  it('connects to the configured CDP URL on acquire', async () => {
    const fakeContext = { close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn(async () => fakeContext), close: vi.fn() };
    (chromium.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeBrowser);

    const provider = new CdpProvider();
    const session = await provider.acquireSession('run-1');

    expect(chromium.connect).toHaveBeenCalledWith('ws://my-chrome:9222', { timeout: 10_000 });
    expect(session.cdpUrl).toBe('ws://my-chrome:9222');
    expect(session.providerName).toBe('cdp');
    expect(session.contextId).toBeDefined();
  });

  it('returns the same session on a second acquire for the same run (idempotent)', async () => {
    const fakeContext = { close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn(async () => fakeContext), close: vi.fn() };
    (chromium.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeBrowser);

    const provider = new CdpProvider();
    const a = await provider.acquireSession('run-idem');
    const b = await provider.acquireSession('run-idem');

    expect(a.contextId).toBe(b.contextId);
    expect(chromium.connect).toHaveBeenCalledTimes(1);
  });

  it('closes context on release and is idempotent', async () => {
    const fakeContext = { close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn(async () => fakeContext), close: vi.fn() };
    (chromium.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeBrowser);

    const provider = new CdpProvider();
    await provider.acquireSession('run-rel');
    await provider.releaseSession('run-rel');
    await provider.releaseSession('run-rel'); // idempotent — second call no-op

    expect(fakeContext.close).toHaveBeenCalledTimes(1);
  });

  it('does NOT close the browser on release', async () => {
    const fakeContext = { close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn(async () => fakeContext), close: vi.fn() };
    (chromium.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeBrowser);

    const provider = new CdpProvider();
    await provider.acquireSession('run-nobrowserclose');
    await provider.releaseSession('run-nobrowserclose');

    expect(fakeBrowser.close).not.toHaveBeenCalled();
  });

  it('getContext returns null before acquire', () => {
    const provider = new CdpProvider();
    expect(provider.getContext('run-unknown')).toBeNull();
  });

  it('getContext returns the live context after acquire', async () => {
    const fakeContext = { close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn(async () => fakeContext), close: vi.fn() };
    (chromium.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeBrowser);

    const provider = new CdpProvider();
    await provider.acquireSession('run-ctx');

    expect(provider.getContext('run-ctx')).toBe(fakeContext);
  });

  it('closes the browser if newContext throws', async () => {
    const closed = vi.fn().mockResolvedValue(undefined);
    const fakeBrowser = {
      newContext: vi.fn(async () => {
        throw new Error('newContext failed');
      }),
      close: closed,
    };
    (chromium.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeBrowser);

    const p = new CdpProvider();
    await expect(p.acquireSession('run-leak')).rejects.toThrow(/newContext failed/);
    expect(closed).toHaveBeenCalled();
  });
});
