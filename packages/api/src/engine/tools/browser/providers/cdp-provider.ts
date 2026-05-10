import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { createLogger } from '@clawix/shared';

import {
  type BrowserProvider,
  type BrowserSession,
  BrowserProviderConfigError,
} from '../browser-provider.js';

const logger = createLogger('engine:tools:browser:cdp-provider');

interface RunBinding {
  browser: Browser;
  context: BrowserContext;
  session: BrowserSession;
}

export class CdpProvider implements BrowserProvider {
  readonly name = 'cdp';
  private readonly bindings = new Map<string, RunBinding>();
  private readonly cdpUrl: string;
  private counter = 0;

  constructor() {
    const cdpUrl = process.env['BROWSER_CDP_URL'];
    if (!cdpUrl) {
      throw new BrowserProviderConfigError('BROWSER_CDP_URL is required for cdp provider');
    }
    this.cdpUrl = cdpUrl;
  }

  async acquireSession(runId: string): Promise<BrowserSession> {
    const existing = this.bindings.get(runId);
    if (existing) return existing.session;

    const browser = await chromium.connect(this.cdpUrl, { timeout: 10_000 });
    let context: BrowserContext;
    try {
      context = await browser.newContext({ ignoreHTTPSErrors: false });
    } catch (err) {
      await browser.close().catch(() => {});
      throw err;
    }

    const session: BrowserSession = {
      cdpUrl: this.cdpUrl,
      contextId: `cdp-${++this.counter}`,
      providerName: this.name,
    };

    this.bindings.set(runId, { browser, context, session });
    logger.info({ runId, contextId: session.contextId }, 'cdp browser session acquired');
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
    // Do NOT close the underlying browser — it's not ours to stop.
  }

  /** Test/internal-use helper: returns the live BrowserContext for tools to drive. */
  getContext(runId: string): BrowserContext | null {
    return this.bindings.get(runId)?.context ?? null;
  }
}
