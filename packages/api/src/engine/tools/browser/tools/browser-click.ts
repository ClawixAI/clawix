/**
 * browser_click tool — clicks an element identified by an @e<n> snapshot ref.
 *
 * Requires a prior browser_snapshot call to populate the ref map.
 */
import { createLogger } from '@clawix/shared';

import type { Tool, ToolResult } from '../../../tool.js';
import type { BrowserSessionManager } from '../browser-session-manager.js';
import type { RunContextResolver } from './browser-navigate.js';

const logger = createLogger('engine:tools:browser:click');

const BROWSER_OP_TIMEOUT_MS = Number(process.env['BROWSER_OP_TIMEOUT_MS'] ?? 10_000);

/** Validates that ref matches the @e<n> pattern. */
const REF_PATTERN = /^@e\d+$/;

export function createBrowserClickTool(
  manager: BrowserSessionManager,
  getRunContext: RunContextResolver,
): Tool {
  return {
    name: 'browser_click',
    description:
      'Click an element by its @e<n> ref from browser_snapshot. ' +
      'Must call browser_navigate and browser_snapshot first.',
    parameters: {
      type: 'object',
      properties: {
        ref: {
          type: 'string',
          description: 'Snapshot ref to click, e.g. @e1',
        },
      },
      required: ['ref'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const ref = params['ref'];

      if (typeof ref !== 'string' || !ref) {
        return { output: 'validation: ref is required', isError: true };
      }

      if (!REF_PATTERN.test(ref)) {
        return { output: `validation: invalid ref "${ref}" — expected @e<number>`, isError: true };
      }

      const ctx = getRunContext();

      const context = manager.getPlaywrightContext(ctx.runId);
      if (!context) {
        return { output: 'browser_click: navigate first', isError: true };
      }

      const pages = context.pages();
      if (!pages.length) {
        return { output: 'browser_click: navigate first', isError: true };
      }

      const refMap = manager.getSnapshotRefs(ctx.runId);
      if (!refMap || refMap.size === 0) {
        return { output: 'validation: navigate and snapshot first', isError: true };
      }

      if (!refMap.has(ref)) {
        return { output: `validation: unknown ref ${ref}`, isError: true };
      }

      const locator = refMap.get(ref) as { click(opts: { timeout: number }): Promise<void> };

      const page = pages[0] as unknown as { url(): string };

      try {
        await locator.click({ timeout: BROWSER_OP_TIMEOUT_MS });
        const newUrl = page.url();
        return { output: JSON.stringify({ ok: true, newUrl }), isError: false };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn({ runId: ctx.runId, ref, reason }, 'browser_click failed');
        return { output: `browser_click: ${reason}`, isError: true };
      }
    },
  };
}
