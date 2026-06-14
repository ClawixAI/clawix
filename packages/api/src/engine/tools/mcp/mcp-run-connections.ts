/**
 * Per-run cache of live MCP client connections (lazy connect on first tool
 * call, reuse for the rest of the run, closed in the runner's finally block).
 * The CALLER's connection credential is decrypted transiently at connect
 * time only.
 */
import { createLogger } from '@clawix/shared';

import type { McpConnection, McpServer } from '../../../generated/prisma/client.js';
import { decrypt } from '../../../common/crypto.js';
import type { ConnectedMcpClient, McpClientService } from '../../../mcp/mcp-client.service.js';
import type { McpTokenManager } from '../../../mcp/mcp-token-manager.service.js';

const logger = createLogger('engine:tools:mcp:connections');

interface OAuthDeps {
  tokenManager?: Pick<McpTokenManager, 'getAccessToken'>;
  userId?: string;
}

export class McpRunConnections {
  private readonly clients = new Map<string, Promise<ConnectedMcpClient>>();

  constructor(
    private readonly clientService: McpClientService,
    private readonly decryptFn: (ciphertext: string) => string = decrypt,
    private readonly oauth: OAuthDeps = {},
  ) {}

  async getClient(server: McpServer, connection: McpConnection): Promise<ConnectedMcpClient> {
    let entry = this.clients.get(server.id);
    if (!entry) {
      entry = this.buildClient(server, connection);
      this.clients.set(server.id, entry);
      // Never cache a failed connection — the next call should retry.
      entry.catch(() => this.clients.delete(server.id));
    }
    return entry;
  }

  private async buildClient(
    server: McpServer,
    connection: McpConnection,
  ): Promise<ConnectedMcpClient> {
    let authHeaderName = server.authHeaderName;
    let credential: string | null = connection.credentialEnc
      ? this.decryptFn(connection.credentialEnc)
      : null;
    if (server.authType === 'oauth') {
      if (!this.oauth.tokenManager || !this.oauth.userId) {
        throw new Error('OAuth connection used without a token manager');
      }
      const token = await this.oauth.tokenManager.getAccessToken(connection.id, this.oauth.userId);
      authHeaderName = 'Authorization';
      credential = `Bearer ${token}`;
    }
    return this.clientService.connect({
      url: server.url,
      transportType: server.transportType,
      authHeaderName,
      credential,
    });
  }

  /** Close every opened client. Safe to call when nothing was opened. */
  async closeAll(): Promise<void> {
    const entries = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(
      entries.map(async (p) => {
        try {
          const client = await p;
          await client.close();
        } catch (err) {
          logger.debug({ err: err instanceof Error ? err.message : String(err) }, 'close skipped');
        }
      }),
    );
  }
}
