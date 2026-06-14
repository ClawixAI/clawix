import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { ExternalServiceError } from '@clawix/shared';

import { createMockRedisClient, createMockConfigService } from './mock-redis.js';
import type { MockRedisClient, MockConfigService } from './mock-redis.js';
import { RedisService } from '../redis.service.js';

// Mock ioredis — named export Redis is the class constructor
vi.mock('ioredis', () => {
  const mockClient = createMockRedisClient();
  return {
    Redis: vi.fn(() => mockClient),
    __mockClient: mockClient,
  };
});

// Access the shared mock client
async function getMockClient(): Promise<MockRedisClient> {
  const mod = await import('ioredis');
  return (mod as unknown as { __mockClient: MockRedisClient }).__mockClient;
}

describe('RedisService', () => {
  let service: RedisService;
  let mockClient: MockRedisClient;
  let mockConfig: MockConfigService;

  beforeEach(async () => {
    mockClient = await getMockClient();
    // Reset all mocks
    for (const fn of Object.values(mockClient)) {
      if (typeof fn === 'function' && 'mockClear' in fn) {
        fn.mockClear();
      }
    }
    mockClient.connect.mockResolvedValue(undefined);
    mockClient.quit.mockResolvedValue('OK');
    mockClient.ping.mockResolvedValue('PONG');
    mockClient.get.mockResolvedValue(null);
    mockClient.set.mockResolvedValue('OK');
    mockClient.del.mockResolvedValue(1);
    mockClient.exists.mockResolvedValue(1);
    mockClient.expire.mockResolvedValue(1);
    mockClient.ttl.mockResolvedValue(-1);
    mockClient.incr.mockResolvedValue(1);
    mockClient.incrby.mockResolvedValue(1);
    mockClient.mget.mockResolvedValue([]);
    mockClient.scan.mockResolvedValue(['0', []]);

    mockConfig = createMockConfigService();
    service = new RedisService(mockConfig as unknown as ConfigService);
  });

  describe('onModuleInit', () => {
    it('should connect to Redis', async () => {
      await service.onModuleInit();
      expect(mockClient.connect).toHaveBeenCalledOnce();
    });

    it('should throw ExternalServiceError on connection failure', async () => {
      mockClient.connect.mockRejectedValue(new Error('Connection refused'));

      await expect(service.onModuleInit()).rejects.toThrow(ExternalServiceError);
    });

    it('should throw ExternalServiceError on timeout', async () => {
      mockClient.connect.mockImplementation(
        () =>
          new Promise(() => {
            /* never resolves */
          }),
      );

      await expect(service.onModuleInit()).rejects.toThrow(ExternalServiceError);
    }, 10_000);
  });

  describe('onModuleDestroy', () => {
    it('should disconnect from Redis', async () => {
      await service.onModuleDestroy();
      expect(mockClient.quit).toHaveBeenCalledOnce();
    });
  });

  describe('get', () => {
    it('should return deserialized value on cache hit', async () => {
      const data = { name: 'test', count: 42 };
      mockClient.get.mockResolvedValue(JSON.stringify(data));

      const result = await service.get<typeof data>('key1');

      expect(result).toEqual(data);
      expect(mockClient.get).toHaveBeenCalledWith('key1');
    });

    it('should return null on cache miss', async () => {
      mockClient.get.mockResolvedValue(null);

      const result = await service.get('missing');

      expect(result).toBeNull();
    });

    it('should return null on invalid JSON', async () => {
      mockClient.get.mockResolvedValue('not-json{');

      const result = await service.get('bad-json');

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should set value without TTL', async () => {
      await service.set('key1', { value: 'data' });

      expect(mockClient.set).toHaveBeenCalledWith('key1', '{"value":"data"}');
    });

    it('should set value with TTL', async () => {
      await service.set('key1', { value: 'data' }, { ttlSeconds: 300 });

      expect(mockClient.set).toHaveBeenCalledWith('key1', '{"value":"data"}', 'EX', 300);
    });
  });

  describe('del', () => {
    it('should return true when key was deleted', async () => {
      mockClient.del.mockResolvedValue(1);

      const result = await service.del('key1');

      expect(result).toBe(true);
    });

    it('should return false when key did not exist', async () => {
      mockClient.del.mockResolvedValue(0);

      const result = await service.del('missing');

      expect(result).toBe(false);
    });
  });

  describe('exists', () => {
    it('should return true when key exists', async () => {
      mockClient.exists.mockResolvedValue(1);

      const result = await service.exists('key1');

      expect(result).toBe(true);
    });

    it('should return false when key does not exist', async () => {
      mockClient.exists.mockResolvedValue(0);

      const result = await service.exists('missing');

      expect(result).toBe(false);
    });
  });

  describe('expire', () => {
    it('should set TTL and return true', async () => {
      mockClient.expire.mockResolvedValue(1);

      const result = await service.expire('key1', 60);

      expect(result).toBe(true);
      expect(mockClient.expire).toHaveBeenCalledWith('key1', 60);
    });

    it('should return false when key does not exist', async () => {
      mockClient.expire.mockResolvedValue(0);

      const result = await service.expire('missing', 60);

      expect(result).toBe(false);
    });
  });

  describe('ttl', () => {
    it('should return TTL from Redis', async () => {
      mockClient.ttl.mockResolvedValue(120);

      const result = await service.ttl('key1');

      expect(result).toBe(120);
    });
  });

  describe('incr', () => {
    it('should return incremented value', async () => {
      mockClient.incr.mockResolvedValue(5);

      const result = await service.incr('counter');

      expect(result).toBe(5);
    });
  });

  describe('incrBy', () => {
    it('should return incremented value', async () => {
      mockClient.incrby.mockResolvedValue(10);

      const result = await service.incrBy('counter', 5);

      expect(result).toBe(10);
      expect(mockClient.incrby).toHaveBeenCalledWith('counter', 5);
    });
  });

  describe('mget', () => {
    it('should return deserialized values', async () => {
      mockClient.mget.mockResolvedValue([JSON.stringify({ a: 1 }), null, JSON.stringify({ b: 2 })]);

      const result = await service.mget<{ a?: number; b?: number }>(['k1', 'k2', 'k3']);

      expect(result).toEqual([{ a: 1 }, null, { b: 2 }]);
    });

    it('should return empty array for empty input', async () => {
      const result = await service.mget([]);

      expect(result).toEqual([]);
      expect(mockClient.mget).not.toHaveBeenCalled();
    });

    it('should return null for invalid JSON entries', async () => {
      mockClient.mget.mockResolvedValue(['not-json', JSON.stringify({ ok: true })]);

      const result = await service.mget(['k1', 'k2']);

      expect(result).toEqual([null, { ok: true }]);
    });
  });

  describe('delByPattern', () => {
    it('should delete matching keys using SCAN', async () => {
      mockClient.scan
        .mockResolvedValueOnce(['42', ['key:1', 'key:2']])
        .mockResolvedValueOnce(['0', ['key:3']]);
      mockClient.del.mockResolvedValue(2).mockResolvedValueOnce(2).mockResolvedValueOnce(1);

      const result = await service.delByPattern('key:*');

      expect(result).toBe(3);
      expect(mockClient.scan).toHaveBeenCalledTimes(2);
    });

    it('should return 0 when no keys match', async () => {
      mockClient.scan.mockResolvedValue(['0', []]);

      const result = await service.delByPattern('nonexistent:*');

      expect(result).toBe(0);
    });
  });

  describe('ping', () => {
    it('should return true on PONG', async () => {
      mockClient.ping.mockResolvedValue('PONG');

      const result = await service.ping();

      expect(result).toBe(true);
    });

    it('should return false on error', async () => {
      mockClient.ping.mockRejectedValue(new Error('Connection lost'));

      const result = await service.ping();

      expect(result).toBe(false);
    });
  });

  describe('getClient', () => {
    it('should return the underlying Redis client', () => {
      const client = service.getClient();
      expect(client).toBeDefined();
    });
  });

  describe('lpush', () => {
    it('pushes values to a list and returns new length', async () => {
      mockClient.lpush.mockResolvedValue(3);
      const result = await service.lpush('mylist', 'a', 'b');
      expect(mockClient.lpush).toHaveBeenCalledWith('mylist', 'a', 'b');
      expect(result).toBe(3);
    });
  });

  describe('lmove', () => {
    it('moves element between lists and returns it', async () => {
      mockClient.lmove.mockResolvedValue('item-data');
      const result = await service.lmove('src', 'dst', 'RIGHT', 'LEFT');
      expect(mockClient.lmove).toHaveBeenCalledWith('src', 'dst', 'RIGHT', 'LEFT');
      expect(result).toBe('item-data');
    });

    it('returns null when source list is empty', async () => {
      mockClient.lmove.mockResolvedValue(null);
      const result = await service.lmove('src', 'dst', 'RIGHT', 'LEFT');
      expect(result).toBeNull();
    });
  });

  describe('lrem', () => {
    it('removes matching elements and returns count', async () => {
      mockClient.lrem.mockResolvedValue(2);
      const result = await service.lrem('mylist', 1, 'value');
      expect(mockClient.lrem).toHaveBeenCalledWith('mylist', 1, 'value');
      expect(result).toBe(2);
    });
  });

  describe('llen', () => {
    it('returns list length', async () => {
      mockClient.llen.mockResolvedValue(5);
      const result = await service.llen('mylist');
      expect(mockClient.llen).toHaveBeenCalledWith('mylist');
      expect(result).toBe(5);
    });
  });

  describe('lrange', () => {
    it('returns elements in range', async () => {
      mockClient.lrange.mockResolvedValue(['a', 'b', 'c']);
      const result = await service.lrange('mylist', 0, -1);
      expect(mockClient.lrange).toHaveBeenCalledWith('mylist', 0, -1);
      expect(result).toEqual(['a', 'b', 'c']);
    });
  });

  describe('setNx', () => {
    it('returns true when key was set (lock acquired)', async () => {
      mockClient.set.mockResolvedValue('OK');
      const result = await service.setNx('lockkey', '1', 300);
      expect(mockClient.set).toHaveBeenCalledWith('lockkey', '1', 'EX', 300, 'NX');
      expect(result).toBe(true);
    });

    it('returns false when key already exists (lock not acquired)', async () => {
      mockClient.set.mockResolvedValue(null);
      const result = await service.setNx('lockkey', '1', 300);
      expect(result).toBe(false);
    });
  });

  describe('acquireLock', () => {
    it('returns true when SET NX succeeds', async () => {
      mockClient.set.mockResolvedValue('OK');
      expect(await service.acquireLock('k', 5)).toBe(true);
      expect(mockClient.set).toHaveBeenCalledWith('k', '1', 'EX', 5, 'NX');
    });
    it('returns false when key already held', async () => {
      mockClient.set.mockResolvedValue(null);
      expect(await service.acquireLock('k', 5)).toBe(false);
    });
    it('releaseLock deletes the key', async () => {
      mockClient.del.mockResolvedValue(1);
      await service.releaseLock('k');
      expect(mockClient.del).toHaveBeenCalledWith('k');
    });
  });
});
