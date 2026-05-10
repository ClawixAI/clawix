/**
 * withInstrumentation — wraps a browser Tool so every execute() call emits
 * a structured info log containing {runId, userId, tool, durationMs, isError}.
 *
 * The wrapper preserves the original tool's name, description, and parameters
 * so registration and schema remain identical to the unwrapped version.
 */

import { createLogger } from '@clawix/shared';

import type { Tool, ToolResult } from '../../../tool.js';
import type { RunContextResolver } from './browser-navigate.js';

const logger = createLogger('engine:tools:browser');

export function withInstrumentation(tool: Tool, getRunContext: RunContextResolver): Tool {
  const originalExecute = tool.execute.bind(tool);

  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const start = Date.now();
      const ctx = getRunContext();

      try {
        const result = await originalExecute(params);
        logger.info(
          {
            runId: ctx.runId,
            userId: ctx.userId,
            tool: tool.name,
            durationMs: Date.now() - start,
            isError: result.isError ?? false,
          },
          'browser tool finished',
        );
        return result;
      } catch (err) {
        logger.error(
          {
            runId: ctx.runId,
            userId: ctx.userId,
            tool: tool.name,
            durationMs: Date.now() - start,
            err,
          },
          'browser tool exception',
        );
        throw err;
      }
    },
  };
}
