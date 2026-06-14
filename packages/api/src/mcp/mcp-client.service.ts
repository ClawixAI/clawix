/**
 * Thin wrapper around the official MCP TypeScript SDK client.
 *
 * Security: every connect (a) runs the SSRF guard against
 * MCP_INTERNAL_ALLOWLIST and (b) receives the decrypted credential only as a
 * transient parameter — nothing is stored on the service.
 */
import { Injectable } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Agent, fetch as undiciFetch } from 'undici';
import { createLogger } from '@clawix/shared';

import { validateUrl } from '../engine/tools/web/ssrf-protection.js';

const logger = createLogger('mcp:client');
const MCP_ALLOWLIST_ENV = 'MCP_INTERNAL_ALLOWLIST';

export interface McpConnectionParams {
  readonly url: string;
  readonly transportType: 'http' | 'sse';
  readonly authHeaderName?: string | null;
  readonly credential?: string | null; // decrypted plaintext — transient only
}

export interface DiscoveredTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface McpCallResult {
  readonly output: string;
  readonly isError: boolean;
}

export interface ConnectedMcpClient {
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpCallResult>;
  close(): Promise<void>;
}

/** Map MCP CallToolResult.content blocks into a single output string. */
export function mapContentToOutput(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      const block = item as { type?: string; text?: string; mimeType?: string };
      if (block.type === 'text') return block.text ?? '';
      if (block.type === 'image') return `[image ${block.mimeType ?? 'unknown'}]`;
      return `[${block.type ?? 'unknown'} content]`;
    })
    .filter((s) => s.length > 0)
    .join('\n');
}

@Injectable()
export class McpClientService {
  /** Connect, list tools, close. Used at admin import/refresh and to verify user credentials at connect time. */
  async discover(params: McpConnectionParams): Promise<readonly DiscoveredTool[]> {
    const { client, dispatcher } = await this.openClient(params);
    try {
      const res = await client.listTools();
      return res.tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: (t.inputSchema ?? { type: 'object' }) as Record<string, unknown>,
      }));
    } finally {
      try {
        await client.close();
      } catch {
        // ignore close errors during discovery
      }
      // Close the pinned dispatcher with the client to free its socket pool.
      await dispatcher.close().catch(() => undefined);
    }
  }

  /** Open a long-lived (per-run) connection. Caller owns close(). */
  async connect(params: McpConnectionParams): Promise<ConnectedMcpClient> {
    const { client, dispatcher } = await this.openClient(params);
    return {
      callTool: async (name, args, signal) => {
        const result = await client.callTool({ name, arguments: args }, undefined, { signal });
        return {
          output: mapContentToOutput(result.content),
          isError: result.isError === true,
        };
      },
      close: async () => {
        try {
          await client.close();
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'MCP close failed',
          );
        }
        // Close the pinned dispatcher with the client to free its socket pool.
        await dispatcher.close().catch(() => undefined);
      },
    };
  }

  /**
   * Open and connect an MCP client.
   *
   * DNS-pinned to the SSRF-validated IP (TOCTOU rebinding defense, mirrors
   * web-fetch): `validateUrl` resolves the hostname and returns `resolvedIp`;
   * we dispatch every transport request through an undici Agent whose
   * `connect.lookup` returns that exact IP, so the TCP connection lands on the
   * same address the SSRF guard approved — an attacker who flips DNS between
   * validation and connect can't redirect us to a private/metadata IP.
   */
  private async openClient(
    params: McpConnectionParams,
  ): Promise<{ client: Client; dispatcher: Agent }> {
    const validated = await validateUrl(params.url, { allowlistEnv: MCP_ALLOWLIST_ENV });
    const headers: Record<string, string> = {};
    if (params.authHeaderName && params.credential) {
      headers[params.authHeaderName] = params.credential;
    }
    const url = new URL(params.url);
    const { pinnedFetch, dispatcher } = this.createPinnedFetch(validated.resolvedIp);
    const client = new Client({ name: 'clawix', version: '1.0.0' });
    const transport =
      params.transportType === 'sse'
        ? // SSE needs auth + pinning on BOTH legs: `requestInit`/the top-level
          // `fetch` cover the recurring POST messages, while the initial
          // stream-opening GET is driven by `eventSourceInit`. Its fetch
          // wrapper must inject the auth header AND dispatch through the
          // DNS-pinned agent; without it the GET re-resolves DNS (rebinding)
          // and skips the auth header (401 on stream-authenticating servers).
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          new SSEClientTransport(url, {
            requestInit: { headers },
            fetch: pinnedFetch,
            eventSourceInit: {
              fetch: (fetchUrl, init) =>
                pinnedFetch(fetchUrl, {
                  ...init,
                  headers: { ...init.headers, ...headers },
                }),
            },
          })
        : new StreamableHTTPClientTransport(url, {
            requestInit: { headers },
            fetch: pinnedFetch,
          });
    // Close the transport AND the pinned dispatcher if the handshake fails
    // (server down / bad credential — the routine path for discover()-based
    // verification), otherwise the socket / AbortController / Agent pool leaks.
    try {
      await client.connect(transport);
    } catch (err) {
      await transport.close().catch(() => undefined);
      await dispatcher.close().catch(() => undefined);
      throw err;
    }
    return { client, dispatcher };
  }

  /**
   * Build a `fetch` bound to a DNS-pinned undici Agent. Every connection the
   * SDK opens through it resolves to `resolvedIp` (mirrors web-fetch's Agent),
   * defeating DNS-rebinding between SSRF validation and connect.
   *
   * Returns the `dispatcher` alongside the fetch so the caller can close it
   * with the client — the Agent's only other reference lives inside the fetch
   * closure, which neither `client.close()` nor `transport.close()` reaches,
   * so leaving it open leaks the keep-alive socket pool (mirrors web-fetch's
   * `dispatcher.close()` in its `finally`).
   */
  private createPinnedFetch(resolvedIp: string): { pinnedFetch: typeof fetch; dispatcher: Agent } {
    const dispatcher = new Agent({
      connect: {
        lookup: (_hostname, _options, callback) => {
          callback(null, [{ address: resolvedIp, family: resolvedIp.includes(':') ? 6 : 4 }]);
        },
      },
    });
    const pinnedFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      undiciFetch(
        input as Parameters<typeof undiciFetch>[0],
        {
          ...init,
          dispatcher,
        } as Parameters<typeof undiciFetch>[1],
      )) as typeof fetch;
    return { pinnedFetch, dispatcher };
  }
}
