/**
 * browser_console tool — drains buffered browser console entries.
 *
 * Listeners are attached lazily on first access; calling this before
 * browser_navigate returns a validation error.
 */
import { createLogger } from '@clawix/shared';

import type { Tool, ToolResult } from '../../../tool.js';
import type { BrowserSessionManager } from '../browser-session-manager.js';
import type { RunContextResolver } from './browser-navigate.js';

const logger = createLogger('engine:tools:browser:console');

/**
 * Create the browser_console tool. Returns all console entries buffered since
 * the optional `since` timestamp (epoch ms). Pass `since` from the last call's
 * highest `ts` to receive only new messages.
 */
export function createBrowserConsoleTool(
  manager: BrowserSessionManager,
  getRunContext: RunContextResolver,
): Tool {
  return {
    name: 'browser_console',
    description:
      'Read buffered browser console messages (log, warn, error, info, debug). ' +
      'Use after browser_navigate. Pass `since` (epoch ms) to retrieve only new entries ' +
      'since a previous call.',
    parameters: {
      type: 'object',
      properties: {
        since: {
          type: 'number',
          description:
            'Only return entries with ts > since (epoch ms). Omit to return all entries.',
        },
      },
      required: [],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const ctx = getRunContext();
      const context = manager.getPlaywrightContext(ctx.runId);

      if (!context) {
        return { output: 'validation: navigate first', isError: true };
      }

      const pages = context.pages();
      if (!pages.length) {
        return { output: 'validation: navigate first', isError: true };
      }

      const page = pages[0]!;
      manager.attachPageListeners(ctx.runId, page as never);

      const since = typeof params['since'] === 'number' ? params['since'] : undefined;

      try {
        const entries = manager.drainConsole(ctx.runId, since);
        return { output: JSON.stringify(entries), isError: false };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn({ reason }, 'browser_console failed');
        return { output: `browser_console: ${reason}`, isError: true };
      }
    },
  };
}
