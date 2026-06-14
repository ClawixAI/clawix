import { describe, it, expect, vi } from 'vitest';
import { McpRunConnections } from './mcp-run-connections.js';
import type { McpConnection, McpServer } from '../../../generated/prisma/client.js';

const SERVER = {
  id: 'srv1',
  url: 'https://x.example/mcp',
  transportType: 'http',
  authHeaderName: 'Authorization',
} as unknown as McpServer;

const CONNECTION = {
  id: 'conn1',
  mcpServerId: 'srv1',
  userId: 'u1',
  credentialEnc: 'enc(tok)',
} as unknown as McpConnection;

function makeClientService() {
  const close = vi.fn(async () => undefined);
  const callTool = vi.fn(async () => ({ output: 'ok', isError: false }));
  const connect = vi.fn(async () => ({ callTool, close }));
  return { connect, close, callTool };
}

describe('McpRunConnections', () => {
  it('connects lazily once per server with the connection credential, then reuses', async () => {
    const cs = makeClientService();
    const conns = new McpRunConnections(cs as never, (s) => s.replace(/^enc\(|\)$/g, ''));
    expect(cs.connect).not.toHaveBeenCalled();

    const a = await conns.getClient(SERVER, CONNECTION);
    const b = await conns.getClient(SERVER, CONNECTION);
    expect(a).toBe(b);
    expect(cs.connect).toHaveBeenCalledTimes(1);
    expect(cs.connect).toHaveBeenCalledWith(
      expect.objectContaining({ credential: 'tok' }), // decrypted transiently
    );
  });

  it('passes null credential when the connection has none (authType=none)', async () => {
    const cs = makeClientService();
    const conns = new McpRunConnections(cs as never, (s) => s);
    await conns.getClient(SERVER, { ...CONNECTION, credentialEnc: null } as never);
    expect(cs.connect).toHaveBeenCalledWith(expect.objectContaining({ credential: null }));
  });

  it('does not cache failed connections', async () => {
    const cs = makeClientService();
    cs.connect.mockRejectedValueOnce(new Error('refused'));
    const conns = new McpRunConnections(cs as never, (s) => s);

    await expect(conns.getClient(SERVER, CONNECTION)).rejects.toThrow('refused');
    await conns.getClient(SERVER, CONNECTION); // retries
    expect(cs.connect).toHaveBeenCalledTimes(2);
  });

  it('closeAll closes every opened client and clears the cache', async () => {
    const cs = makeClientService();
    const conns = new McpRunConnections(cs as never, (s) => s);
    await conns.getClient(SERVER, CONNECTION);
    await conns.closeAll();
    expect(cs.close).toHaveBeenCalledTimes(1);
    await conns.getClient(SERVER, CONNECTION); // fresh connect after teardown
    expect(cs.connect).toHaveBeenCalledTimes(2);
  });
});

describe('McpRunConnections oauth credential', () => {
  it('uses the token manager Bearer token for oauth servers', async () => {
    const cs = makeClientService();
    const tokenManager = { getAccessToken: vi.fn().mockResolvedValue('ya29.live') };
    const conns = new McpRunConnections(cs as never, undefined, {
      tokenManager: tokenManager as never,
      userId: 'user-1',
    });
    await conns.getClient(
      {
        id: 's1',
        url: 'http://gw:8000/mcp/',
        transportType: 'http',
        authType: 'oauth',
        authHeaderName: null,
      } as never,
      { id: 'c1', credentialEnc: null } as never,
    );
    expect(tokenManager.getAccessToken).toHaveBeenCalledWith('c1', 'user-1');
    expect(cs.connect).toHaveBeenCalledWith(
      expect.objectContaining({ authHeaderName: 'Authorization', credential: 'Bearer ya29.live' }),
    );
  });

  it('falls back to credentialEnc for header servers', async () => {
    const cs = makeClientService();
    const conns = new McpRunConnections(cs as never, (c) => `dec(${c})`);
    await conns.getClient(
      {
        id: 's2',
        url: 'u',
        transportType: 'http',
        authType: 'header',
        authHeaderName: 'Authorization',
      } as never,
      { id: 'c2', credentialEnc: 'enc' } as never,
    );
    expect(cs.connect).toHaveBeenCalledWith(expect.objectContaining({ credential: 'dec(enc)' }));
  });

  it('throws when an oauth server is used without a token manager', async () => {
    const cs = makeClientService();
    const conns = new McpRunConnections(cs as never);
    await expect(
      conns.getClient(
        {
          id: 's3',
          url: 'u',
          transportType: 'http',
          authType: 'oauth',
          authHeaderName: null,
        } as never,
        { id: 'c3', credentialEnc: null } as never,
      ),
    ).rejects.toThrow(/token manager/);
  });
});
