/**
 * browser_cdp tool — sends a raw Chrome DevTools Protocol (CDP) command to
 * the active Playwright page. Requires policy.allowBrowserCdp=true.
 *
 * For Page.navigate commands, the target URL is validated against the SSRF
 * protection list before forwarding to CDP.
 */
import { createLogger } from '@clawix/shared';

import type { Tool, ToolResult } from '../../../tool.js';
import type { BrowserSessionManager } from '../browser-session-manager.js';
import type { RunContextResolver } from './browser-navigate.js';
import { validateUrl } from '../../web/ssrf-protection.js';

const logger = createLogger('engine:tools:browser:cdp');

/**
 * Create the browser_cdp tool.
 */
export function createBrowserCdpTool(
  manager: BrowserSessionManager,
  getRunContext: RunContextResolver,
): Tool {
  return {
    name: 'browser_cdp',
    description:
      'Send a raw Chrome DevTools Protocol (CDP) command to the current page. ' +
      'Requires a policy with CDP access enabled (allowBrowserCdp=true). ' +
      'Use sparingly — prefer higher-level browser tools when available.',
    parameters: {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          description: 'CDP method name (e.g. "Page.reload", "Runtime.evaluate")',
        },
        params: {
          type: 'object',
          description: 'Optional CDP method parameters',
        },
      },
      required: ['method'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const ctx = getRunContext();

      // Policy gate
      if (!ctx.policy.allowBrowserCdp) {
        return {
          output: 'browser_cdp: requires a policy with CDP access (allowBrowserCdp=true)',
          isError: true,
        };
      }

      // Validate method
      const method = params['method'];
      if (typeof method !== 'string' || !method) {
        return { output: 'validation: method is required', isError: true };
      }

      // SSRF guard for Page.navigate
      const cdpParams = params['params'] as Record<string, unknown> | undefined;
      if (method === 'Page.navigate' && cdpParams !== null && cdpParams !== undefined) {
        const url = cdpParams['url'];
        if (typeof url === 'string') {
          try {
            await validateUrl(url);
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            return { output: `browser_cdp validation: ${reason}`, isError: true };
          }
        }
      }

      // Get Playwright context
      const context = manager.getPlaywrightContext(ctx.runId);
      if (!context) {
        return { output: 'browser_cdp: navigate first', isError: true };
      }

      const pages = context.pages();
      const page = pages[0];
      if (!page) {
        return { output: 'browser_cdp: navigate first', isError: true };
      }

      let cdp: {
        send: (m: never, p: never) => Promise<unknown>;
        detach: () => Promise<void>;
      } | null = null;
      try {
        cdp = await page.context().newCDPSession(page);
        const result = await cdp.send(method as never, cdpParams as never);
        return { output: JSON.stringify(result), isError: false };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn({ method, reason }, 'browser_cdp failed');
        return { output: `browser_cdp: ${reason}`, isError: true };
      } finally {
        await cdp?.detach().catch(() => undefined);
      }
    },
  };
}
