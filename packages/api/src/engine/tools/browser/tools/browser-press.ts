/**
 * browser_press tool — presses a keyboard key on the current page.
 *
 * Uses Playwright's `page.keyboard.press(key)`. Does not require a snapshot
 * ref; operates on the focused element or the page globally.
 */
import { createLogger } from '@clawix/shared';

import type { Tool, ToolResult } from '../../../tool.js';
import type { BrowserSessionManager } from '../browser-session-manager.js';
import type { RunContextResolver } from './browser-navigate.js';

const logger = createLogger('engine:tools:browser:press');

export function createBrowserPressTool(
  manager: BrowserSessionManager,
  getRunContext: RunContextResolver,
): Tool {
  return {
    name: 'browser_press',
    description:
      'Press a keyboard key on the current page (e.g. Enter, Tab, Escape, ArrowDown). ' +
      'Operates on the currently focused element. ' +
      'Must call browser_navigate first.',
    parameters: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description:
            'Key to press, e.g. "Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", ' +
            '"Space", "Backspace", "Delete", "Home", "End"',
        },
      },
      required: ['key'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const key = params['key'];

      if (typeof key !== 'string' || !key) {
        return { output: 'validation: key is required', isError: true };
      }

      const ctx = getRunContext();

      const context = manager.getPlaywrightContext(ctx.runId);
      if (!context) {
        return { output: 'browser_press: navigate first', isError: true };
      }

      const pages = context.pages();
      if (!pages.length) {
        return { output: 'browser_press: navigate first', isError: true };
      }

      interface PressPage {
        keyboard: { press(key: string): Promise<void> };
      }

      const page = pages[0] as unknown as PressPage;

      try {
        // Playwright's keyboard.press does not reliably accept a timeout option
        // across all versions, so we call it without one.
        await page.keyboard.press(key);
        return { output: JSON.stringify({ ok: true }), isError: false };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn({ runId: ctx.runId, key, reason }, 'browser_press failed');
        return { output: `browser_press: ${reason}`, isError: true };
      }
    },
  };
}
