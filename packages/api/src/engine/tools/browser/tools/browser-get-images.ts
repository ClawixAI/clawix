/**
 * browser_get_images tool — extracts all images from the current page.
 */
import { createLogger } from '@clawix/shared';

import type { Tool, ToolResult } from '../../../tool.js';
import type { BrowserSessionManager } from '../browser-session-manager.js';
import type { RunContextResolver } from './browser-navigate.js';

const logger = createLogger('engine:tools:browser:get-images');

/** Represents a single image found on the page. */
interface PageImage {
  url: string;
  alt: string;
}

/**
 * Create the browser_get_images tool. Extracts all `<img>` elements from
 * the active page and returns their resolved source URL and alt text.
 */
export function createBrowserGetImagesTool(
  manager: BrowserSessionManager,
  getRunContext: RunContextResolver,
): Tool {
  return {
    name: 'browser_get_images',
    description:
      'Extract all images from the current browser page. ' +
      'Returns a JSON array of objects with `url` (resolved src) and `alt` fields.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },

    async execute(_params: Record<string, unknown>): Promise<ToolResult> {
      const ctx = getRunContext();
      const context = manager.getPlaywrightContext(ctx.runId);
      if (!context) {
        return { output: 'browser_get_images: navigate first', isError: true };
      }

      const pages = context.pages();
      if (!pages.length) {
        return { output: 'browser_get_images: navigate first', isError: true };
      }
      const page = pages[0]!;

      try {
        const images = await page.evaluate(
          () =>
            Array.from(document.images).map((img) => ({
              url: img.currentSrc || img.src,
              alt: img.alt || '',
            })) as PageImage[],
        );

        return { output: JSON.stringify(images), isError: false };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn({ reason }, 'browser_get_images failed');
        return { output: `browser_get_images: ${reason}`, isError: true };
      }
    },
  };
}
