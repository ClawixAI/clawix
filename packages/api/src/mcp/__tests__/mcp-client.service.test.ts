import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConnect = vi.fn();
const mockListTools = vi.fn();
const mockCallTool = vi.fn();
const mockClose = vi.fn();

// Each transport ctor returns a fresh object carrying a `close` spy so we can
// assert it was the instance passed to client.connect() and that it gets
// closed on a failed handshake.
const mockTransportClose = vi.fn().mockResolvedValue(undefined);
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    listTools: mockListTools,
    callTool: mockCallTool,
    close: mockClose,
  })),
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi
    .fn()
    .mockImplementation(() => ({ kind: 'http', close: mockTransportClose })),
}));
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: vi
    .fn()
    .mockImplementation(() => ({ kind: 'sse', close: mockTransportClose })),
}));
vi.mock('../../engine/tools/web/ssrf-protection.js', () => ({
  validateUrl: vi.fn().mockResolvedValue({
    hostname: 'x',
    resolvedIp: '1.2.3.4',
    port: 443,
    pathname: '/',
    protocol: 'https',
  }),
}));

// Mock undici so we can assert the DNS-pinned Agent is constructed with the
// SSRF-validated IP and that transport fetches dispatch through it. Hoisted
// because the vi.mock factory runs before module-level const initialization.
const { mockAgentInstance, mockAgentClose, mockAgentCtor, mockUndiciFetch } = vi.hoisted(() => {
  const close = vi.fn().mockResolvedValue(undefined);
  const instance = { id: 'pinned-agent', close };
  return {
    mockAgentInstance: instance,
    mockAgentClose: close,
    mockAgentCtor: vi.fn().mockImplementation(() => instance),
    mockUndiciFetch: vi.fn().mockResolvedValue({ ok: true }),
  };
});
vi.mock('undici', () => ({
  Agent: mockAgentCtor,
  fetch: mockUndiciFetch,
}));

import { McpClientService, mapContentToOutput } from '../mcp-client.service.js';
import { validateUrl } from '../../engine/tools/web/ssrf-protection.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const PARAMS = {
  url: 'https://api.githubcopilot.com/mcp/',
  transportType: 'http' as const,
  authHeaderName: 'Authorization',
  credential: 'Bearer tok',
};

describe('mapContentToOutput', () => {
  it('joins text blocks and summarizes images', () => {
    const out = mapContentToOutput([
      { type: 'text', text: 'hello' },
      { type: 'image', mimeType: 'image/png', data: '...' },
      { type: 'text', text: 'world' },
    ]);
    expect(out).toBe('hello\n[image image/png]\nworld');
  });

  it('returns empty string for non-array content', () => {
    expect(mapContentToOutput(undefined)).toBe('');
  });
});

describe('McpClientService', () => {
  let svc: McpClientService;

  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks wipes resolved values; the service awaits these closes.
    mockAgentClose.mockResolvedValue(undefined);
    mockTransportClose.mockResolvedValue(undefined);
    svc = new McpClientService();
  });

  it('discover validates the URL with the MCP allowlist env', async () => {
    mockListTools.mockResolvedValue({
      tools: [{ name: 't', description: 'd', inputSchema: { type: 'object' } }],
    });
    const tools = await svc.discover(PARAMS);
    expect(validateUrl).toHaveBeenCalledWith(PARAMS.url, {
      allowlistEnv: 'MCP_INTERNAL_ALLOWLIST',
    });
    expect(tools).toEqual([{ name: 't', description: 'd', inputSchema: { type: 'object' } }]);
    expect(mockClose).toHaveBeenCalled(); // discover closes its connection
    expect(mockAgentClose).toHaveBeenCalled(); // ...and frees the pinned dispatcher
  });

  it('connect returns a client whose callTool maps content and isError', async () => {
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false });
    const conn = await svc.connect(PARAMS);
    const result = await conn.callTool('do_thing', { a: 1 });
    expect(result).toEqual({ output: 'ok', isError: false });
    expect(mockCallTool).toHaveBeenCalledWith(
      { name: 'do_thing', arguments: { a: 1 } },
      undefined,
      { signal: undefined },
    );
  });

  it('propagates isError=true from the server', async () => {
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'boom' }], isError: true });
    const conn = await svc.connect(PARAMS);
    const result = await conn.callTool('do_thing', {});
    expect(result.isError).toBe(true);
  });

  it('close() closes both the client and the pinned dispatcher', async () => {
    const conn = await svc.connect(PARAMS);
    expect(mockAgentClose).not.toHaveBeenCalled(); // not closed until caller closes
    await conn.close();
    expect(mockClose).toHaveBeenCalled();
    expect(mockAgentClose).toHaveBeenCalled();
  });

  it('builds the HTTP transport with the auth header and a DNS-pinned fetch', async () => {
    await svc.connect(PARAMS);
    expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        requestInit: { headers: { Authorization: 'Bearer tok' } },
        fetch: expect.any(Function),
      }),
    );
    expect(SSEClientTransport).not.toHaveBeenCalled();
    // client.connect() must receive the constructed transport instance.
    const transportInstance = vi.mocked(StreamableHTTPClientTransport).mock.results[0]!.value;
    expect(mockConnect).toHaveBeenCalledWith(transportInstance);

    // The supplied fetch must dispatch through an undici Agent pinned to the
    // SSRF-validated IP (TOCTOU rebinding defense).
    expect(mockAgentCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        connect: expect.objectContaining({ lookup: expect.any(Function) }),
      }),
    );
    const opts = vi.mocked(StreamableHTTPClientTransport).mock.calls[0]![1]!;
    await (opts.fetch as (u: unknown, i?: unknown) => Promise<unknown>)(
      'https://api.example.com',
      {},
    );
    expect(mockUndiciFetch).toHaveBeenCalledWith(
      'https://api.example.com',
      expect.objectContaining({ dispatcher: mockAgentInstance }),
    );
    // The Agent's lookup callback resolves to the validated IP, not a re-resolution.
    const lookup = mockAgentCtor.mock.calls[0]![0].connect.lookup;
    const cb = vi.fn();
    lookup('evil.example.com', {}, cb);
    expect(cb).toHaveBeenCalledWith(null, [{ address: '1.2.3.4', family: 4 }]);
  });

  it('builds the SSE transport with a pinned fetch and auth on both legs', async () => {
    await svc.connect({ ...PARAMS, transportType: 'sse' });
    expect(SSEClientTransport).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        requestInit: { headers: { Authorization: 'Bearer tok' } },
        // POST-leg pinning.
        fetch: expect.any(Function),
        // Stream-GET-leg pinning + header injection.
        eventSourceInit: expect.objectContaining({ fetch: expect.any(Function) }),
      }),
    );
    expect(StreamableHTTPClientTransport).not.toHaveBeenCalled();
    const transportInstance = vi.mocked(SSEClientTransport).mock.results[0]!.value;
    expect(mockConnect).toHaveBeenCalledWith(transportInstance);

    // The eventSourceInit.fetch wrapper must inject the auth header AND dispatch
    // through the DNS-pinned agent: the resulting undici call carries both the
    // merged headers and the pinned dispatcher.
    const opts = vi.mocked(SSEClientTransport).mock.calls[0]![1]!;
    const customFetch = opts.eventSourceInit!.fetch!;
    await customFetch('https://api.example.com/mcp', {
      headers: { Accept: 'text/event-stream' },
    } as never);
    expect(mockUndiciFetch).toHaveBeenCalledWith(
      'https://api.example.com/mcp',
      expect.objectContaining({
        headers: { Accept: 'text/event-stream', Authorization: 'Bearer tok' },
        dispatcher: mockAgentInstance,
      }),
    );
  });

  it('closes the transport and the pinned dispatcher when the handshake (connect) rejects', async () => {
    mockConnect.mockRejectedValueOnce(new Error('server down'));
    await expect(svc.connect(PARAMS)).rejects.toThrow('server down');
    expect(mockTransportClose).toHaveBeenCalled();
    expect(mockAgentClose).toHaveBeenCalled();
  });
});
