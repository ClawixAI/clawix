/**
 * browser_dialog tool — interact with a pending browser dialog (alert/confirm/prompt).
 *
 * Dialog events are buffered by the page-listener helper added to
 * BrowserSessionManager. Call browser_navigate before using this tool.
 */
import { createLogger } from '@clawix/shared';

import type { Tool, ToolResult } from '../../../tool.js';
import type { BrowserSessionManager } from '../browser-session-manager.js';
import type { RunContextResolver } from './browser-navigate.js';

const logger = createLogger('engine:tools:browser:dialog');

const VALID_ACTIONS = ['accept', 'dismiss'] as const;
type DialogAction = (typeof VALID_ACTIONS)[number];

/**
 * Create the browser_dialog tool. Interacts with the oldest pending dialog
 * buffered on the active page. Returns `{ ok: true, type }` on success.
 */
export function createBrowserDialogTool(
  manager: BrowserSessionManager,
  getRunContext: RunContextResolver,
): Tool {
  return {
    name: 'browser_dialog',
    description:
      'Accept or dismiss a browser dialog (alert, confirm, prompt, beforeunload). ' +
      'Use after a page action that triggers a dialog. ' +
      'For prompts, pass `text` to supply the input value when accepting.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: VALID_ACTIONS,
          description: 'Whether to accept or dismiss the dialog',
        },
        text: {
          type: 'string',
          description: 'Text to enter into a prompt dialog when accepting (optional)',
        },
      },
      required: ['action'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const action = params['action'];
      if (!action || typeof action !== 'string') {
        return { output: 'validation: action is required', isError: true };
      }
      if (!(VALID_ACTIONS as readonly string[]).includes(action)) {
        return {
          output: `validation: action must be one of ${VALID_ACTIONS.join(', ')}`,
          isError: true,
        };
      }

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

      const pending = manager.peekPendingDialog(ctx.runId);
      if (!pending) {
        return { output: 'browser_dialog: no pending dialog', isError: true };
      }

      const text = typeof params['text'] === 'string' ? params['text'] : undefined;

      try {
        await pending.resolve(action as DialogAction, text);
        manager.shiftPendingDialog(ctx.runId);

        return {
          output: JSON.stringify({ ok: true, type: pending.type }),
          isError: false,
        };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn({ action, reason }, 'browser_dialog failed');
        return { output: `browser_dialog: ${reason}`, isError: true };
      }
    },
  };
}
