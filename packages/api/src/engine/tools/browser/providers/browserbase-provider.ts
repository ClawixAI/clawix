import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { createLogger } from '@clawix/shared';

import {
  type BrowserProvider,
  type BrowserSession,
  BrowserProviderConfigError,
  BrowserProviderUnavailableError,
} from '../browser-provider.js';

const logger = createLogger('engine:tools:browser:browserbase-provider');

const API_BASE = 'https://api.browserbase.com/v1';

interface RunBinding {
  sessionId: string;
  session: BrowserSession;
  browser: Browser;
  context: BrowserContext;
}

interface BrowserbaseSessionResponse {
  id: string;
  connectUrl: string;
}

export class BrowserbaseProvider implements BrowserProvider {
  readonly name = 'browserbase';
  private readonly bindings = new Map<string, RunBinding>();
  private readonly apiKey: string;
  private readonly projectId: string;

  constructor() {
    const apiKey = process.env['BROWSERBASE_API_KEY'];
    const projectId = process.env['BROWSERBASE_PROJECT_ID'];

    if (!apiKey) {
      throw new BrowserProviderConfigError(
        'BROWSERBASE_API_KEY is required for browserbase provider',
      );
    }
    if (!projectId) {
      throw new BrowserProviderConfigError(
        'BROWSERBASE_PROJECT_ID is required for browserbase provider',
      );
    }

    this.apiKey = apiKey;
    this.projectId = projectId;
  }

  async acquireSession(runId: string): Promise<BrowserSession> {
    const existing = this.bindings.get(runId);
    if (existing) return existing.session;

    const res = await fetch(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: {
        'x-bb-api-key': this.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ projectId: this.projectId }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new BrowserProviderUnavailableError(
        `browserbase create-session ${res.status}: ${text}`,
      );
    }

    const body = (await res.json()) as BrowserbaseSessionResponse;

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    try {
      browser = await chromium.connect(body.connectUrl, { timeout: 10_000 });
      context = await browser.newContext({ ignoreHTTPSErrors: false });

      const session: BrowserSession = {
        cdpUrl: body.connectUrl,
        contextId: body.id,
        providerName: this.name,
      };

      this.bindings.set(runId, { sessionId: body.id, session, browser, context });
      logger.info({ runId, sessionId: body.id }, 'browserbase session acquired');
      return session;
    } catch (err) {
      // Best-effort local cleanup
      try {
        await context?.close();
      } catch {
        // best-effort cleanup; ignore
      }
      try {
        await browser?.close();
      } catch {
        // best-effort cleanup; ignore
      }
      // Best-effort cloud cleanup — avoid leaking the Browserbase session
      try {
        await fetch(`${API_BASE}/sessions/${body.id}`, {
          method: 'DELETE',
          headers: { 'x-bb-api-key': this.apiKey },
        });
      } catch {
        logger.error(
          { runId, sessionId: body.id },
          'failed to clean up Browserbase session after acquire failure',
        );
      }
      throw err;
    }
  }

  async releaseSession(runId: string): Promise<void> {
    const binding = this.bindings.get(runId);
    if (!binding) return;

    this.bindings.delete(runId);

    try {
      await binding.context.close();
    } catch (err) {
      logger.warn({ runId, sessionId: binding.sessionId, err }, 'context close failed; continuing');
    }
    try {
      await binding.browser.close();
    } catch {
      // Ignore — remote browser connection may already be gone.
    }

    try {
      await fetch(`${API_BASE}/sessions/${binding.sessionId}`, {
        method: 'DELETE',
        headers: { 'x-bb-api-key': this.apiKey },
      });
    } catch (err) {
      logger.warn(
        { runId, sessionId: binding.sessionId, err },
        'browserbase session delete failed; continuing',
      );
    }
  }

  /** Test/internal-use helper: returns the live BrowserContext for tools to drive. */
  getContext(runId: string): BrowserContext | null {
    return this.bindings.get(runId)?.context ?? null;
  }
}
