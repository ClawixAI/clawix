import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('playwright-core', () => ({
  chromium: {
    connect: vi.fn(),
  },
}));

import { chromium } from 'playwright-core';
import { BrowserbaseProvider } from './browserbase-provider.js';
import {
  BrowserProviderConfigError,
  BrowserProviderUnavailableError,
} from '../browser-provider.js';

describe('BrowserbaseProvider', () => {
  const ORIGINAL_API_KEY = process.env['BROWSERBASE_API_KEY'];
  const ORIGINAL_PROJECT_ID = process.env['BROWSERBASE_PROJECT_ID'];

  beforeEach(() => {
    process.env['BROWSERBASE_API_KEY'] = 'test-api-key';
    process.env['BROWSERBASE_PROJECT_ID'] = 'test-project-id';
  });

  afterEach(() => {
    if (ORIGINAL_API_KEY === undefined) delete process.env['BROWSERBASE_API_KEY'];
    else process.env['BROWSERBASE_API_KEY'] = ORIGINAL_API_KEY;
    if (ORIGINAL_PROJECT_ID === undefined) delete process.env['BROWSERBASE_PROJECT_ID'];
    else process.env['BROWSERBASE_PROJECT_ID'] = ORIGINAL_PROJECT_ID;
    vi.restoreAllMocks();
  });

  function makeFakePlaywright() {
    const fakeContext = { close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn(async () => fakeContext), close: vi.fn() };
    (chromium.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeBrowser);
    return { fakeContext, fakeBrowser };
  }

  it('throws config error if API key is missing', () => {
    delete process.env['BROWSERBASE_API_KEY'];
    expect(() => new BrowserbaseProvider()).toThrow(BrowserProviderConfigError);
    expect(() => new BrowserbaseProvider()).toThrow(/BROWSERBASE_API_KEY/);
  });

  it('throws config error if project ID is missing', () => {
    delete process.env['BROWSERBASE_PROJECT_ID'];
    expect(() => new BrowserbaseProvider()).toThrow(BrowserProviderConfigError);
    expect(() => new BrowserbaseProvider()).toThrow(/BROWSERBASE_PROJECT_ID/);
  });

  it('creates a session and returns its connectUrl as cdpUrl', async () => {
    makeFakePlaywright();
    const mockResponse = {
      id: 'sess-123',
      connectUrl: 'wss://connect.browserbase.com/sess-123',
    };

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const provider = new BrowserbaseProvider();
    const session = await provider.acquireSession('run-1');

    expect(session.cdpUrl).toBe('wss://connect.browserbase.com/sess-123');
    expect(session.contextId).toBe('sess-123');
    expect(session.providerName).toBe('browserbase');
  });

  it('connects Playwright to the returned connectUrl', async () => {
    makeFakePlaywright();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'sess-pw',
        connectUrl: 'wss://connect.browserbase.com/sess-pw',
      }),
    } as Response);

    const provider = new BrowserbaseProvider();
    await provider.acquireSession('run-pw');

    expect(chromium.connect).toHaveBeenCalledWith('wss://connect.browserbase.com/sess-pw', {
      timeout: 10_000,
    });
  });

  it('getContext returns the live BrowserContext after acquire', async () => {
    const { fakeContext } = makeFakePlaywright();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'sess-ctx', connectUrl: 'wss://connect.browserbase.com/sess-ctx' }),
    } as Response);

    const provider = new BrowserbaseProvider();
    await provider.acquireSession('run-ctx');

    expect(provider.getContext('run-ctx')).toBe(fakeContext);
  });

  it('getContext returns null before acquire', () => {
    const provider = new BrowserbaseProvider();
    expect(provider.getContext('run-unknown')).toBeNull();
  });

  it('posts to the correct endpoint with API key header', async () => {
    makeFakePlaywright();
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'sess-abc', connectUrl: 'wss://connect.browserbase.com/sess-abc' }),
    } as Response);

    const provider = new BrowserbaseProvider();
    await provider.acquireSession('run-2');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.browserbase.com/v1/sessions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-bb-api-key': 'test-api-key' }),
      }),
    );
  });

  it('returns the same session on a second acquire for the same run (idempotent)', async () => {
    makeFakePlaywright();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'sess-idem',
        connectUrl: 'wss://connect.browserbase.com/sess-idem',
      }),
    } as Response);

    const provider = new BrowserbaseProvider();
    const a = await provider.acquireSession('run-idem');
    const b = await provider.acquireSession('run-idem');

    expect(a.contextId).toBe(b.contextId);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('release calls context.close, browser.close, and DELETEs the session', async () => {
    const { fakeContext, fakeBrowser } = makeFakePlaywright();
    const mockFetch = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'sess-del',
          connectUrl: 'wss://connect.browserbase.com/sess-del',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response);

    const provider = new BrowserbaseProvider();
    await provider.acquireSession('run-del');
    await provider.releaseSession('run-del');

    expect(fakeContext.close).toHaveBeenCalledTimes(1);
    expect(fakeBrowser.close).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://api.browserbase.com/v1/sessions/sess-del',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('release is a no-op when no session exists', async () => {
    const mockFetch = vi.spyOn(global, 'fetch');
    const provider = new BrowserbaseProvider();
    await provider.releaseSession('run-nonexistent');

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('non-2xx on create throws BrowserProviderUnavailableError', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    } as Response);

    const provider = new BrowserbaseProvider();
    await expect(provider.acquireSession('run-err')).rejects.toThrow(
      BrowserProviderUnavailableError,
    );
    await expect(provider.acquireSession('run-err')).rejects.toThrow(
      /browserbase create-session 401/,
    );
  });

  it('DELETEs the cloud session if chromium.connect throws (session leak prevention)', async () => {
    (chromium.connect as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('connect failed'),
    );

    const mockFetch = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'sess-leak',
          connectUrl: 'wss://connect.browserbase.com/sess-leak',
        }),
      } as Response)
      .mockResolvedValueOnce({ ok: true } as Response); // DELETE response

    const provider = new BrowserbaseProvider();
    await expect(provider.acquireSession('run-leak')).rejects.toThrow(/connect failed/);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://api.browserbase.com/v1/sessions/sess-leak',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ 'x-bb-api-key': 'test-api-key' }),
      }),
    );
  });
});
