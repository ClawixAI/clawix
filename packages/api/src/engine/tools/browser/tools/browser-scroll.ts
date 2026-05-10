/**
 * browser_scroll tool — scrolls the current page in the given direction.
 */
import { createLogger } from '@clawix/shared';

import type { Tool, ToolResult } from '../../../tool.js';
import type { BrowserSessionManager } from '../browser-session-manager.js';
import type { RunContextResolver } from './browser-navigate.js';

const logger = createLogger('engine:tools:browser:scroll');

const VALID_DIRECTIONS = ['up', 'down', 'left', 'right'] as const;

const DEFAULT_VERTICAL_PX = 800;
const DEFAULT_HORIZONTAL_PX = 1200;

/**
 * Create the browser_scroll tool. Scrolls the active page by the given
 * amount (in pixels) in the specified direction. Uses `window.scrollBy`
 * via `page.evaluate` for deterministic, testable behaviour.
 */
export function createBrowserScrollTool(
  manager: BrowserSessionManager,
  getRunContext: RunContextResolver,
): Tool {
  return {
    name: 'browser_scroll',
    description:
      'Scroll the current browser page in the specified direction. ' +
      'Use after browser_navigate when you need to reveal content below/above the fold.',
    parameters: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: VALID_DIRECTIONS,
          description: 'Direction to scroll: up, down, left, or right',
        },
        amount: {
          type: 'number',
          description:
            'Number of pixels to scroll. Defaults to the viewport height (vertical) or width (horizontal).',
          minimum: 1,
        },
      },
      required: ['direction'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const direction = params['direction'];
      if (!direction || typeof direction !== 'string') {
        return { output: 'validation: direction is required', isError: true };
      }
      if (!(VALID_DIRECTIONS as readonly string[]).includes(direction)) {
        return {
          output: `validation: direction must be one of ${VALID_DIRECTIONS.join(', ')}`,
          isError: true,
        };
      }

      const ctx = getRunContext();
      const context = manager.getPlaywrightContext(ctx.runId);
      if (!context) {
        return { output: 'browser_scroll: navigate first', isError: true };
      }

      const pages = context.pages();
      if (!pages.length) {
        return { output: 'browser_scroll: navigate first', isError: true };
      }
      const page = pages[0]!;

      try {
        const isVertical = direction === 'up' || direction === 'down';
        let scrollAmount: number;

        if (typeof params['amount'] === 'number' && params['amount'] > 0) {
          scrollAmount = params['amount'];
        } else {
          const viewport = page.viewportSize();
          if (viewport) {
            scrollAmount = isVertical ? viewport.height : viewport.width;
          } else {
            scrollAmount = isVertical ? DEFAULT_VERTICAL_PX : DEFAULT_HORIZONTAL_PX;
          }
        }

        let dx = 0;
        let dy = 0;
        if (direction === 'down') {
          dy = scrollAmount;
        } else if (direction === 'up') {
          dy = -scrollAmount;
        } else if (direction === 'right') {
          dx = scrollAmount;
        } else {
          // left
          dx = -scrollAmount;
        }

        await page.evaluate(
          ({ dx: deltaX, dy: deltaY }: { dx: number; dy: number }) =>
            window.scrollBy(deltaX, deltaY),
          { dx, dy },
        );

        return { output: JSON.stringify({ ok: true }), isError: false };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn({ direction, reason }, 'browser_scroll failed');
        return { output: `browser_scroll: ${reason}`, isError: true };
      }
    },
  };
}
