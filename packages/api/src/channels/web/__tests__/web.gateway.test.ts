import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { WebChatGateway } from '../web.gateway.js';

// Mock logger
vi.mock('@clawix/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clawix/shared')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

function mockSocket(overrides?: Record<string, unknown>) {
  return { readyState: 1, send: vi.fn(), close: vi.fn(), on: vi.fn(), ...overrides };
}

function mockRequest(url: string): IncomingMessage {
  return { url } as IncomingMessage;
}

const mockJwtService = { verifyAsync: vi.fn() };
const mockConfigService = { getOrThrow: vi.fn().mockReturnValue('test-jwt-secret') };
const mockAdapter = {
  addConnection: vi.fn(),
  removeConnection: vi.fn(),
  handleClientMessage: vi.fn().mockResolvedValue(undefined),
};
const mockHttpAdapterHost = {
  httpAdapter: {
    getHttpServer: vi.fn().mockReturnValue({}),
  },
};

describe('WebChatGateway', () => {
  let gateway: WebChatGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    mockJwtService.verifyAsync.mockReset();
    mockConfigService.getOrThrow.mockReturnValue('test-jwt-secret');
    mockAdapter.handleClientMessage.mockResolvedValue(undefined);
    gateway = new WebChatGateway(
      mockJwtService as never,
      mockConfigService as never,
      mockHttpAdapterHost as never,
    );
    gateway.setAdapter(mockAdapter as never);
  });

  describe('handleConnection — valid JWT', () => {
    it('calls adapter.addConnection and sends connection.ack', async () => {
      const payload = { sub: 'user-1', email: 'test@example.com', role: 'developer' };
      mockJwtService.verifyAsync.mockResolvedValue(payload);

      const socket = mockSocket();
      const req = mockRequest('/ws/chat?token=valid.jwt.token');

      await gateway.handleConnection(socket as never, req);

      expect(mockAdapter.addConnection).toHaveBeenCalledWith('user-1', socket);
      expect(socket.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(socket.send.mock.calls[0]![0] as string);
      expect(sent.type).toBe('connection.ack');
      expect(sent.payload.userId).toBe('user-1');
    });
  });

  describe('handleConnection — invalid JWT', () => {
    it('closes socket with 4001 and does NOT call adapter.addConnection', async () => {
      mockJwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));

      const socket = mockSocket();
      const req = mockRequest('/ws/chat?token=bad.jwt.token');

      await gateway.handleConnection(socket as never, req);

      expect(socket.close).toHaveBeenCalledWith(4001, 'unauthorized');
      expect(mockAdapter.addConnection).not.toHaveBeenCalled();
    });
  });

  describe('handleConnection — no token in URL', () => {
    it('closes socket with 4001 when no token query param', async () => {
      const socket = mockSocket();
      const req = mockRequest('/ws/chat');

      await gateway.handleConnection(socket as never, req);

      expect(socket.close).toHaveBeenCalledWith(4001, 'unauthorized');
      expect(mockAdapter.addConnection).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage', () => {
    it('calls adapter.handleClientMessage with userId, email, and raw message', async () => {
      const payload = { sub: 'user-1', email: 'test@example.com', role: 'developer' };
      mockJwtService.verifyAsync.mockResolvedValue(payload);

      const socket = mockSocket();
      const req = mockRequest('/ws/chat?token=valid.jwt.token');

      await gateway.handleConnection(socket as never, req);

      // Find the 'message' callback registered via socket.on
      const onCalls = socket.on.mock.calls;
      const messageCb = onCalls.find(([event]: string[]) => event === 'message')?.[1] as
        | ((raw: string) => Promise<void>)
        | undefined;

      expect(messageCb).toBeDefined();

      const raw = JSON.stringify({ type: 'message.send', payload: { content: 'Hello' } });
      await messageCb!(raw);

      expect(mockAdapter.handleClientMessage).toHaveBeenCalledWith(
        'user-1',
        'test@example.com',
        raw,
      );
    });
  });

  describe('handleDisconnect', () => {
    it('calls adapter.removeConnection when socket closes', async () => {
      const payload = { sub: 'user-1', email: 'test@example.com', role: 'developer' };
      mockJwtService.verifyAsync.mockResolvedValue(payload);

      const socket = mockSocket();
      const req = mockRequest('/ws/chat?token=valid.jwt.token');

      await gateway.handleConnection(socket as never, req);

      // Find the 'close' callback registered via socket.on
      const onCalls = socket.on.mock.calls;
      const closeCb = onCalls.find(([event]: string[]) => event === 'close')?.[1] as
        | (() => void)
        | undefined;

      expect(closeCb).toBeDefined();
      closeCb!();

      expect(mockAdapter.removeConnection).toHaveBeenCalledWith('user-1', socket);
    });
  });
});
