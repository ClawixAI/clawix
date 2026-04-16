import { describe, expect, it } from 'vitest';

import { parseClientMessage, serializeServerMessage, type ServerMessage } from '../web.protocol.js';

describe('web.protocol', () => {
  describe('parseClientMessage', () => {
    it('parses a valid message.send', () => {
      const raw = JSON.stringify({
        type: 'message.send',
        payload: { content: 'Hello agent' },
      });

      const result = parseClientMessage(raw);

      expect(result).toEqual({
        type: 'message.send',
        payload: { content: 'Hello agent' },
      });
    });

    it('parses a ping message', () => {
      const raw = JSON.stringify({ type: 'ping', payload: {} });

      const result = parseClientMessage(raw);

      expect(result).toEqual({ type: 'ping', payload: {} });
    });

    it('returns null for invalid JSON', () => {
      const result = parseClientMessage('not json');

      expect(result).toBeNull();
    });

    it('returns null for unknown message type', () => {
      const raw = JSON.stringify({ type: 'unknown', payload: {} });

      const result = parseClientMessage(raw);

      expect(result).toBeNull();
    });

    it('returns null for message.send with missing content', () => {
      const raw = JSON.stringify({
        type: 'message.send',
        payload: {},
      });

      const result = parseClientMessage(raw);

      expect(result).toBeNull();
    });

    it('returns null for message.send with empty content', () => {
      const raw = JSON.stringify({
        type: 'message.send',
        payload: { content: '' },
      });

      const result = parseClientMessage(raw);

      expect(result).toBeNull();
    });
  });

  describe('serializeServerMessage', () => {
    it('serializes a message.create', () => {
      const msg: ServerMessage = {
        type: 'message.create',
        payload: {
          messageId: 'msg-1',
          sessionId: 'sess-1',
          content: 'Hello human',
          timestamp: '2026-04-01T00:00:00.000Z',
        },
      };

      const result = serializeServerMessage(msg);
      const parsed = JSON.parse(result);

      expect(parsed.type).toBe('message.create');
      expect(parsed.payload.messageId).toBe('msg-1');
      expect(parsed.payload.content).toBe('Hello human');
    });

    it('serializes a connection.ack', () => {
      const msg: ServerMessage = {
        type: 'connection.ack',
        payload: { userId: 'user-1' },
      };

      const result = serializeServerMessage(msg);
      const parsed = JSON.parse(result);

      expect(parsed.type).toBe('connection.ack');
      expect(parsed.payload.userId).toBe('user-1');
    });

    it('serializes typing.start', () => {
      const msg: ServerMessage = { type: 'typing.start', payload: {} };

      const result = serializeServerMessage(msg);
      const parsed = JSON.parse(result);

      expect(parsed.type).toBe('typing.start');
    });

    it('serializes an error', () => {
      const msg: ServerMessage = {
        type: 'error',
        payload: { code: 'INVALID_MESSAGE', message: 'Bad format' },
      };

      const result = serializeServerMessage(msg);
      const parsed = JSON.parse(result);

      expect(parsed.type).toBe('error');
      expect(parsed.payload.code).toBe('INVALID_MESSAGE');
    });
  });
});
