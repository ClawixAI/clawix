/**
 * Builds Tool wrappers for a run's bound MCP servers from the cached catalog
 * (zero network at registration; connections open lazily on first call with
 * the CALLER's credential).
 *
 * Skip rules: server not enabled (admin kill switch) → notify owner (deduped);
 * caller has no active connection → silent skip. TOFU: only tools present in
 * BOTH the explicit binding allowlist AND the cached catalog register.
 */
import { createLogger } from '@clawix/shared';
import type { McpBindings } from '@clawix/shared';

import type { McpServerForRun } from '../../../db/mcp-server.repository.js';
import type { AuditLogRepository } from '../../../db/audit-log.repository.js';
import type { NotificationRepository } from '../../../db/notification.repository.js';
import type { McpConnection, McpTool as McpToolRow } from '../../../generated/prisma/client.js';
import { NotificationType } from '../../../generated/prisma/enums.js';
import type { ParamSchema, Tool, ToolResult } from '../../tool.js';
import type { ToolRegistry } from '../../tool-registry.js';
import { scanContextContent } from '../../prompt-injection-scanner.js';
import { mcpToolCallDurationSeconds, mcpToolCallsTotal } from './mcp-metrics.js';
import type { McpRunConnections } from './mcp-run-connections.js';

const logger = createLogger('engine:tools:mcp:factory');

/** Anthropic/OpenAI tool-name limit. */
const MAX_TOOL_NAME_LENGTH = 64;

export interface RegisterMcpToolsOptions {
  readonly servers: readonly McpServerForRun[];
  readonly bindings: McpBindings;
  readonly connections: McpRunConnections;
  readonly audit: Pick<AuditLogRepository, 'create'>;
  readonly notifications: Pick<NotificationRepository, 'create' | 'hasUnreadMcpAttention'>;
  readonly userId: string;
  readonly agentRunId: string;
}

export async function registerMcpTools(
  registry: ToolRegistry,
  opts: RegisterMcpToolsOptions,
): Promise<void> {
  const byId = new Map(opts.servers.map((s) => [s.id, s]));

  for (const binding of opts.bindings.servers) {
    const server = byId.get(binding.serverId);
    if (!server) continue; // stale binding (server deleted)

    if (!server.enabled) {
      await maybeNotifyAttention(opts, server.id, server.name, 'admin_disabled');
      continue;
    }

    const connection = server.connections[0]; // repository filtered to the caller
    if (!connection || connection.status !== 'active') {
      if (connection?.status === 'reauth_required') {
        await maybeNotifyAttention(opts, server.id, server.name, 'reauth_required');
      } else {
        logger.debug(
          { serverId: server.id, userId: opts.userId },
          'MCP binding skipped: no active connection',
        );
      }
      continue;
    }

    const allowed = new Set(binding.enabledTools);
    for (const tool of connection.tools) {
      if (!allowed.has(tool.name)) continue; // TOFU: explicit allowlist only

      const toolName = `mcp__${server.slug}__${tool.name}`;
      if (toolName.length > MAX_TOOL_NAME_LENGTH) {
        logger.warn({ toolName }, 'Skipping MCP tool: combined name exceeds 64 chars');
        continue;
      }
      registry.register(createMcpTool(opts, server, connection, tool, toolName));
    }
  }
}

function createMcpTool(
  opts: RegisterMcpToolsOptions,
  server: McpServerForRun,
  connection: McpConnection,
  tool: McpToolRow,
  toolName: string,
): Tool {
  const description = tool.scanFlagged
    ? `[flagged: this tool's description failed the prompt-injection scan (${tool.scanReason ?? 'unknown'})]`
    : tool.description;

  return {
    name: toolName,
    description,
    parameters: tool.inputSchema as unknown as ParamSchema,
    // The MCP server is the source of truth for its own schema — pass params
    // through verbatim instead of running the registry's strict cast/validate/strip.
    rawParams: true,
    async execute(params, ctx): Promise<ToolResult> {
      const started = Date.now();
      let output: string;
      let isError: boolean;
      try {
        const client = await opts.connections.getClient(server, connection);
        const result = await client.callTool(tool.name, params, ctx?.abortSignal);
        const scan = scanContextContent(result.output, `mcp:${toolName}`);
        output = scan.blocked ? scan.sanitized : result.output;
        isError = result.isError;
      } catch (err) {
        output = err instanceof Error ? err.message : String(err);
        isError = true;
      }

      const durationMs = Date.now() - started;
      const status = isError ? 'error' : 'ok';
      mcpToolCallsTotal.inc({ server: server.slug, tool: tool.name, status });
      mcpToolCallDurationSeconds.observe(
        { server: server.slug, tool: tool.name },
        durationMs / 1000,
      );
      try {
        await opts.audit.create({
          userId: opts.userId,
          action: 'mcp.tool.call',
          resource: 'mcp_server',
          resourceId: server.id,
          details: {
            serverId: server.id,
            toolName: tool.name,
            agentRunId: opts.agentRunId,
            isError,
            durationMs,
          },
        });
      } catch (auditErr) {
        logger.error(
          { err: auditErr instanceof Error ? auditErr.message : String(auditErr) },
          'mcp.tool.call audit write failed',
        );
      }
      return { output, isError };
    },
  };
}

/** Fan out an attention notification, deduped on an existing unread one. */
async function maybeNotifyAttention(
  opts: RegisterMcpToolsOptions,
  serverId: string,
  serverName: string,
  reason: string,
): Promise<void> {
  try {
    const already = await opts.notifications.hasUnreadMcpAttention(opts.userId, serverId);
    if (already) return;
    await opts.notifications.create({
      recipientId: opts.userId,
      type: NotificationType.MCP_SERVER_ATTENTION,
      payload: { serverId, serverName, reason },
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'MCP attention notification failed',
    );
  }
}
