/**
 * browser_vision tool — takes a screenshot and describes the current page using
 * a vision-capable model.
 *
 * The agent-runner pre-resolves which provider/model handles the call (and any
 * `modelOverrides.browser_vision` override — model name or `agent:<id>`
 * delegation) at run start, so this tool just consumes the resolved config.
 */
import { createLogger } from '@clawix/shared';

import type { Tool, ToolResult } from '../../../tool.js';
import type { BrowserSessionManager } from '../browser-session-manager.js';
import type { RunContextResolver } from './browser-navigate.js';

const logger = createLogger('engine:tools:browser:vision');

const DEFAULT_PROMPT = 'Describe what is shown on the screen and the main interactive elements.';

/**
 * Create the browser_vision tool.
 */
export function createBrowserVisionTool(
  manager: BrowserSessionManager,
  getRunContext: RunContextResolver,
): Tool {
  return {
    name: 'browser_vision',
    description:
      'Take a screenshot of the current browser page and describe it using a vision-capable model. ' +
      'Useful for visually verifying page state, reading visual-only content, or understanding layout. ' +
      'Requires a vision-capable model configured for the agent.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'What to ask the vision model about the screenshot (optional)',
        },
      },
      required: [],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const ctx = getRunContext();

      if (!ctx.vision.available) {
        return { output: `browser_vision: ${ctx.vision.reason}`, isError: true };
      }

      if (!ctx.vision.capable) {
        return {
          output:
            `browser_vision: model "${ctx.vision.modelLabel}" on provider ` +
            `"${ctx.vision.providerLabel}" is not known to support image input. ` +
            'Configure agentDefinition.toolConfig.modelOverrides.browser_vision ' +
            'to a vision-capable model on the active provider, or to ' +
            '"agent:<id>" to delegate vision to another agent.',
          isError: true,
        };
      }

      // Get Playwright context
      const context = manager.getPlaywrightContext(ctx.runId);
      if (!context) {
        return { output: 'browser_vision: navigate first', isError: true };
      }

      const pages = context.pages();
      const page = pages[0];
      if (!page) {
        return { output: 'browser_vision: navigate first', isError: true };
      }

      try {
        const screenshot = await page.screenshot({ fullPage: false, type: 'png' });
        const prompt = typeof params['prompt'] === 'string' ? params['prompt'] : DEFAULT_PROMPT;
        const description = await ctx.vision.call(screenshot, prompt);
        return { output: description, isError: false };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn({ reason }, 'browser_vision failed');
        return { output: `browser_vision: ${reason}`, isError: true };
      }
    },
  };
}
