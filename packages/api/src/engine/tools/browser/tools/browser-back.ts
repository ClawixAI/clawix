/**
 * browser_back tool — navigates the active browser page back in history.
 */
import { createLogger } from '@clawix/shared';

import type { Tool, ToolResult } from '../../../tool.js';
import type { BrowserSessionManager } from '../browser-session-manager.js';
import type { RunContextResolver } from './browser-navigate.js';

const logger = createLogger('engine:tools:browser:back');

const BROWSER_OP_TIMEOUT_MS = Number(process.env['BROWSER_OP_TIMEOUT_MS'] ?? 10_000);

/**
 * Create the browser_back tool. Navigates the active page back in history.
 * If there is no previous history entry, `page.goBack` returns null; in that
 * case the tool still returns success with the current URL.
 */
export function createBrowserBackTool(
  manager: BrowserSessionManager,
  getRunContext: RunContextResolver,
): Tool {
  return {
    name: 'browser_back',
    description:
      'Navigate the browser back to the previous page in history. ' +
      'Returns the URL of the page landed on. ' +
      'If there is no previous history entry the current URL is returned.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },

    async execute(_params: Record<string, unknown>): Promise<ToolResult> {
      const ctx = getRunContext();
      const context = manager.getPlaywrightContext(ctx.runId);
      if (!context) {
        return { output: 'browser_back: navigate first', isError: true };
      }

      const pages = context.pages();
      if (!pages.length) {
        return { output: 'browser_back: navigate first', isError: true };
      }
      const page = pages[0]!;

      try {
        await page.goBack({ timeout: BROWSER_OP_TIMEOUT_MS });
        const url = page.url();
        return { output: JSON.stringify({ url }), isError: false };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn({ reason }, 'browser_back failed');
        return { output: `browser_back: ${reason}`, isError: true };
      }
    },
  };
}
