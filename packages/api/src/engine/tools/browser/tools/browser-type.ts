/**
 * browser_type tool — clears and types text into a form element identified by
 * an @e<n> snapshot ref.
 *
 * Prefers Playwright's `pressSequentially` (newer API); falls back to `type`.
 */
import { createLogger } from '@clawix/shared';

import type { Tool, ToolResult } from '../../../tool.js';
import type { BrowserSessionManager } from '../browser-session-manager.js';
import type { RunContextResolver } from './browser-navigate.js';

const logger = createLogger('engine:tools:browser:type');

const BROWSER_OP_TIMEOUT_MS = Number(process.env['BROWSER_OP_TIMEOUT_MS'] ?? 10_000);

/** Validates that ref matches the @e<n> pattern. */
const REF_PATTERN = /^@e\d+$/;

interface TypeableLocator {
  fill(text: string): Promise<void>;
  pressSequentially?: (text: string, opts: { timeout: number }) => Promise<void>;
  type?: (text: string, opts: { timeout: number }) => Promise<void>;
}

export function createBrowserTypeTool(
  manager: BrowserSessionManager,
  getRunContext: RunContextResolver,
): Tool {
  return {
    name: 'browser_type',
    description:
      'Clear and type text into a form element by its @e<n> ref from browser_snapshot. ' +
      'Must call browser_navigate and browser_snapshot first.',
    parameters: {
      type: 'object',
      properties: {
        ref: {
          type: 'string',
          description: 'Snapshot ref for the input element, e.g. @e2',
        },
        text: {
          type: 'string',
          description: 'Text to type into the element',
        },
      },
      required: ['ref', 'text'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const ref = params['ref'];
      const text = params['text'];

      if (typeof ref !== 'string' || !ref) {
        return { output: 'validation: ref is required', isError: true };
      }

      if (!REF_PATTERN.test(ref)) {
        return { output: `validation: invalid ref "${ref}" — expected @e<number>`, isError: true };
      }

      if (typeof text !== 'string') {
        return { output: 'validation: text is required', isError: true };
      }

      const ctx = getRunContext();

      const context = manager.getPlaywrightContext(ctx.runId);
      if (!context) {
        return { output: 'browser_type: navigate first', isError: true };
      }

      const pages = context.pages();
      if (!pages.length) {
        return { output: 'browser_type: navigate first', isError: true };
      }

      const refMap = manager.getSnapshotRefs(ctx.runId);
      if (!refMap || refMap.size === 0) {
        return { output: 'validation: navigate and snapshot first', isError: true };
      }

      if (!refMap.has(ref)) {
        return { output: `validation: unknown ref ${ref}`, isError: true };
      }

      const locator = refMap.get(ref) as TypeableLocator;

      try {
        await locator.fill('');

        if (typeof locator.pressSequentially === 'function') {
          await locator.pressSequentially(text, { timeout: BROWSER_OP_TIMEOUT_MS });
        } else if (typeof locator.type === 'function') {
          await locator.type(text, { timeout: BROWSER_OP_TIMEOUT_MS });
        } else {
          return {
            output: 'browser_type: locator does not support type or pressSequentially',
            isError: true,
          };
        }

        return { output: JSON.stringify({ ok: true }), isError: false };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn({ runId: ctx.runId, ref, reason }, 'browser_type failed');
        return { output: `browser_type: ${reason}`, isError: true };
      }
    },
  };
}
