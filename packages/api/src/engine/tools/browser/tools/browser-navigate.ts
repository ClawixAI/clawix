/**
 * browser_navigate tool — navigates the browser to a URL.
 *
 * Acquires a browser session via BrowserSessionManager and (for the mock
 * provider) returns a stub result. Real Playwright navigation is wired in
 * Plan Task 17.
 */
import { createLogger } from '@clawix/shared';

import type { Tool, ToolResult } from '../../../tool.js';
import type { BrowserSessionManager } from '../browser-session-manager.js';
import { validateUrl } from '../../web/ssrf-protection.js';

const logger = createLogger('engine:tools:browser:navigate');

export interface RunContext {
  readonly runId: string;
  readonly userId: string;
  /** The agent's currently active model identifier (provider-resolved). */
  readonly activeModel: string;
  /** AgentDefinition.toolConfig parsed JSON. */
  readonly toolConfig: { modelOverrides?: Record<string, string> };
  /** Per-policy gating fields surfaced for browser tools. */
  readonly policy: { allowBrowserCdp: boolean };
  /**
   * Pre-resolved vision configuration. The agent-runner resolves any
   * `modelOverrides.browser_vision` value at run start — supporting both
   * a same-provider model name and an `agent:<id>` reference that delegates
   * to another agent's provider/model/credentials. The tool consumes this
   * directly without doing any DB work.
   */
  readonly vision: VisionConfig;
}

export type VisionConfig =
  | {
      readonly available: true;
      /**
       * `true` when the resolved (provider, model) pair is known to support
       * image input — either matched by `supportsVisionModel` or an explicit
       * operator-supplied override was used. The browser_vision tool returns
       * a clear error when this is false.
       */
      readonly capable: boolean;
      readonly providerLabel: string;
      readonly modelLabel: string;
      /** Invokes the resolved provider with a screenshot + prompt. */
      readonly call: (screenshotPng: Buffer, prompt: string) => Promise<string>;
    }
  | {
      readonly available: false;
      /** Reason browser_vision can't run — surfaced verbatim to the agent. */
      readonly reason: string;
    };

export type RunContextResolver = () => RunContext;

/**
 * Create the browser_navigate tool. Real Playwright navigation lands in a
 * later task; this version returns a stub for the mock provider so unit
 * tests can validate wiring.
 */
export function createBrowserNavigateTool(
  manager: BrowserSessionManager,
  getRunContext: RunContextResolver,
): Tool {
  return {
    name: 'browser_navigate',
    description:
      'Navigate the browser to a URL. Initializes the browser session and loads the page. ' +
      'Must be called before other browser tools. ' +
      'For simple information retrieval, prefer web_search or web_fetch (faster, cheaper). ' +
      'Use browser tools when you need JS-rendered content, login, interaction, or visual verification.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
        waitUntil: {
          type: 'string',
          enum: ['load', 'domcontentloaded', 'networkidle'],
          description: 'When to consider navigation done (default: load)',
        },
      },
      required: ['url'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const url = params['url'];
      if (typeof url !== 'string' || !url) {
        return { output: 'validation: url is required', isError: true };
      }

      try {
        await validateUrl(url);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return { output: `validation: ${reason}`, isError: true };
      }

      const ctx = getRunContext();

      try {
        const session = await manager.acquireForRun({
          runId: ctx.runId,
          userKey: ctx.userId,
        });

        if (session.providerName === 'mock') {
          return {
            output: JSON.stringify({ url, title: '<mock>', status: 200 }),
            isError: false,
          };
        }

        const context = manager.getPlaywrightContext(ctx.runId);
        if (!context) {
          return {
            output: 'browser_navigate: provider does not expose a Playwright context',
            isError: true,
          };
        }

        const pages = context.pages();
        const page = pages[0] ?? (await context.newPage());

        const navTimeout = Number(process.env['BROWSER_NAVIGATE_TIMEOUT_MS'] ?? 30_000);
        const waitUntil =
          (params['waitUntil'] as 'load' | 'domcontentloaded' | 'networkidle' | undefined) ??
          'load';

        const response = await page.goto(url, { waitUntil, timeout: navTimeout });
        const status = response?.status() ?? 0;
        const title = await page.title();

        return {
          output: JSON.stringify({ url: page.url(), title, status }),
          isError: false,
        };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn({ url, reason }, 'browser_navigate failed');
        return { output: `browser_navigate: ${reason}`, isError: true };
      }
    },
  };
}
