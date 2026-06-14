/**
 * Prometheus metrics for MCP tool calls. Module-level singletons —
 * prom-client errors on duplicate registration.
 */
import { Counter, Histogram } from 'prom-client';

/** Total MCP tool calls by server slug, tool, and outcome. */
export const mcpToolCallsTotal = new Counter({
  name: 'clawix_mcp_tool_calls_total',
  help: 'Total MCP tool calls by server, tool, and status.',
  labelNames: ['server', 'tool', 'status'] as const,
});

/** Duration of MCP tool calls in seconds. */
export const mcpToolCallDurationSeconds = new Histogram({
  name: 'clawix_mcp_tool_call_duration_seconds',
  help: 'Duration of MCP tool calls.',
  labelNames: ['server', 'tool'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
});
