import { vi } from 'vitest';

export function createMockRedisClient() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    exists: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(-1),
    incr: vi.fn().mockResolvedValue(1),
    incrby: vi.fn().mockResolvedValue(1),
    mget: vi.fn().mockResolvedValue([]),
    scan: vi.fn().mockResolvedValue(['0', []]),
    ping: vi.fn().mockResolvedValue('PONG'),
    publish: vi.fn().mockResolvedValue(1),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    psubscribe: vi.fn().mockResolvedValue(undefined),
    punsubscribe: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
    removeAllListeners: vi.fn().mockReturnThis(),
    lpush: vi.fn().mockResolvedValue(1),
    lmove: vi.fn().mockResolvedValue(null),
    lrem: vi.fn().mockResolvedValue(0),
    llen: vi.fn().mockResolvedValue(0),
    lrange: vi.fn().mockResolvedValue([]),
    eval: vi.fn().mockResolvedValue(1),
  };
}

export type MockRedisClient = ReturnType<typeof createMockRedisClient>;

export function createMockConfigService(url = 'redis://localhost:6379') {
  return {
    getOrThrow: vi.fn().mockReturnValue(url),
  };
}

export type MockConfigService = ReturnType<typeof createMockConfigService>;
