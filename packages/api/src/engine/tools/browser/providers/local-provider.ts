import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { createLogger } from '@clawix/shared';

import {
  type BrowserProvider,
  type BrowserSession,
  BrowserProviderConfigError,
  BrowserProviderUnavailableError,
} from '../browser-provider.js';

const logger = createLogger('engine:tools:browser:local-provider');

interface RunBinding {
  browser: Browser;
  context: BrowserContext;
  session: BrowserSession;
}

export class LocalProvider implements BrowserProvider {
  readonly name = 'local';
  private readonly bindings = new Map<string, RunBinding>();
  private counter = 0;

  constructor() {
    if (!process.env['BROWSER_AUTH_TOKEN']) {
      throw new BrowserProviderConfigError('BROWSER_AUTH_TOKEN is required for local provider');
    }
  }

  async acquireSession(runId: string): Promise<BrowserSession> {
    const existing = this.bindings.get(runId);
    if (existing) return existing.session;

    // Playwright's chromium.connect() speaks the Playwright wire protocol, so
    // we must hit browserless's `/chromium/playwright` route. The default `/`
    // route proxies raw CDP, which causes Playwright to disconnect immediately
    // after the WebSocket upgrade and surfaces as a connect timeout on our end.
    const baseUrl = process.env['BROWSER_SIDECAR_URL'] ?? 'ws://clawix-browser:3000';
    const url = this.appendPlaywrightPath(baseUrl);
    const token = process.env['BROWSER_AUTH_TOKEN']!;
    const sep = url.includes('?') ? '&' : '?';
    const connectUrl = `${url}${sep}token=${encodeURIComponent(token)}`;

    let browser: Browser;
    try {
      browser = await chromium.connect(connectUrl, { timeout: 10_000 });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new BrowserProviderUnavailableError(`sidecar connect failed: ${reason}`);
    }

    let context: BrowserContext;
    try {
      context = await browser.newContext({ ignoreHTTPSErrors: false });
    } catch (err) {
      await browser.close().catch(() => {});
      throw err;
    }
    const session: BrowserSession = {
      cdpUrl: connectUrl,
      contextId: `local-${++this.counter}`,
      providerName: this.name,
    };
    this.bindings.set(runId, { browser, context, session });
    logger.info({ runId, contextId: session.contextId }, 'local browser session acquired');
    return session;
  }

  async releaseSession(runId: string): Promise<void> {
    const binding = this.bindings.get(runId);
    if (!binding) return;
    this.bindings.delete(runId);
    try {
      await binding.context.close();
    } catch (err) {
      logger.warn({ runId, err }, 'context close failed; continuing');
    }
    try {
      await binding.browser.close();
    } catch {
      // Ignore — browser might already be disconnected.
    }
  }

  /** Test/internal-use helper: returns the live BrowserContext for tools to drive. */
  getContext(runId: string): BrowserContext | null {
    return this.bindings.get(runId)?.context ?? null;
  }

  private appendPlaywrightPath(baseUrl: string): string {
    const queryIdx = baseUrl.indexOf('?');
    const origin = queryIdx === -1 ? baseUrl : baseUrl.slice(0, queryIdx);
    const query = queryIdx === -1 ? '' : baseUrl.slice(queryIdx + 1);
    const trimmed = origin.replace(/\/+$/, '');
    if (/\/(chromium\/playwright|playwright\/chromium)$/.test(trimmed)) {
      return baseUrl;
    }
    const withPath = `${trimmed}/chromium/playwright`;
    return query ? `${withPath}?${query}` : withPath;
  }
}
