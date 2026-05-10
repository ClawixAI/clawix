import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('playwright-core', () => ({
  chromium: {
    connect: vi.fn(),
  },
}));

import { chromium } from 'playwright-core';
import { LocalProvider } from './local-provider.js';

describe('LocalProvider', () => {
  const ORIGINAL_URL = process.env['BROWSER_SIDECAR_URL'];
  const ORIGINAL_TOKEN = process.env['BROWSER_AUTH_TOKEN'];

  beforeEach(() => {
    process.env['BROWSER_SIDECAR_URL'] = 'ws://test-sidecar:3000';
    process.env['BROWSER_AUTH_TOKEN'] = 'test-token';
  });

  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env['BROWSER_SIDECAR_URL'];
    else process.env['BROWSER_SIDECAR_URL'] = ORIGINAL_URL;
    if (ORIGINAL_TOKEN === undefined) delete process.env['BROWSER_AUTH_TOKEN'];
    else process.env['BROWSER_AUTH_TOKEN'] = ORIGINAL_TOKEN;
    vi.clearAllMocks();
  });

  it('connects to the configured sidecar URL with the auth token appended', async () => {
    const fakeContext = { close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn(async () => fakeContext), close: vi.fn() };
    (chromium.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeBrowser);

    const p = new LocalProvider();
    const session = await p.acquireSession('run-1');

    expect(chromium.connect).toHaveBeenCalledWith(
      expect.stringContaining('token=test-token'),
      expect.any(Object),
    );
    expect(session.providerName).toBe('local');
    expect(session.contextId).toBeDefined();
  });

  it('targets the /chromium/playwright route so the playwright wire protocol is used', async () => {
    const fakeContext = { close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn(async () => fakeContext), close: vi.fn() };
    (chromium.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeBrowser);

    const p = new LocalProvider();
    await p.acquireSession('run-route');

    expect(chromium.connect).toHaveBeenCalledWith(
      expect.stringContaining('/chromium/playwright?'),
      expect.any(Object),
    );
  });

  it('does not double-append the playwright path if the URL already includes it', async () => {
    process.env['BROWSER_SIDECAR_URL'] = 'ws://test-sidecar:3000/chromium/playwright';
    const fakeContext = { close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn(async () => fakeContext), close: vi.fn() };
    (chromium.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeBrowser);

    const p = new LocalProvider();
    await p.acquireSession('run-noop');

    const calls = (chromium.connect as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const calledWith = calls[0]?.[0] as string;
    expect(calledWith.match(/\/chromium\/playwright/g)).toHaveLength(1);
  });

  it('returns the same session on a second acquire for the same run', async () => {
    const fakeContext = { close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn(async () => fakeContext), close: vi.fn() };
    (chromium.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeBrowser);

    const p = new LocalProvider();
    const a = await p.acquireSession('run-1');
    const b = await p.acquireSession('run-1');

    expect(a.contextId).toBe(b.contextId);
    expect(chromium.connect).toHaveBeenCalledTimes(1);
  });

  it('release closes the context and is idempotent', async () => {
    const fakeContext = { close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn(async () => fakeContext), close: vi.fn() };
    (chromium.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeBrowser);

    const p = new LocalProvider();
    await p.acquireSession('run-1');
    await p.releaseSession('run-1');
    await p.releaseSession('run-1'); // idempotent — second call no-op

    expect(fakeContext.close).toHaveBeenCalledTimes(1);
  });

  it('throws on missing BROWSER_AUTH_TOKEN at construction', () => {
    delete process.env['BROWSER_AUTH_TOKEN'];
    expect(() => new LocalProvider()).toThrow(/BROWSER_AUTH_TOKEN/);
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

    const p = new LocalProvider();
    await expect(p.acquireSession('run-leak')).rejects.toThrow(/newContext failed/);
    expect(closed).toHaveBeenCalled();
  });
});
