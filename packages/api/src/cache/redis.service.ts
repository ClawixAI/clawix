import { Inject, Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { createLogger, ExternalServiceError } from '@clawix/shared';
import { REDIS_CONNECT_TIMEOUT_MS, SCAN_BATCH_SIZE } from './cache.constants.js';
import type { CacheSetOptions } from './cache.types.js';

const logger = createLogger('redis');

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly client: Redis;

  constructor(@Inject(ConfigService) configService: ConfigService) {
    const url = configService.getOrThrow<string>('REDIS_URL');
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });
  }

  async onModuleInit(): Promise<void> {
    logger.info('Connecting to Redis...');
    try {
      await Promise.race([
        this.client.connect(),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error('Redis connection timed out'));
          }, REDIS_CONNECT_TIMEOUT_MS);
        }),
      ]);
      logger.info('Redis connected');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ err: error }, 'Failed to connect to Redis');
      throw new ExternalServiceError('redis', message);
    }
  }

  async onModuleDestroy(): Promise<void> {
    logger.info('Disconnecting from Redis...');
    await this.client.quit();
    logger.info('Redis disconnected');
  }

  /** Get a value by key, deserializing from JSON. Returns null on miss or parse error. */
  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw === null) {
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      logger.warn({ key }, 'Failed to parse cached value as JSON');
      return null;
    }
  }

  /** Set a value by key, serializing to JSON. Optionally set TTL in seconds. */
  async set(key: string, value: unknown, options?: CacheSetOptions): Promise<void> {
    const serialized = JSON.stringify(value);
    if (options?.ttlSeconds !== undefined) {
      await this.client.set(key, serialized, 'EX', options.ttlSeconds);
    } else {
      await this.client.set(key, serialized);
    }
  }

  /** Delete a key. Returns true if the key existed and was deleted. */
  async del(key: string): Promise<boolean> {
    const count = await this.client.del(key);
    return count === 1;
  }

  /** Check if a key exists. */
  async exists(key: string): Promise<boolean> {
    const count = await this.client.exists(key);
    return count === 1;
  }

  /** Set TTL on an existing key. Returns true if the timeout was set. */
  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.expire(key, ttlSeconds);
    return result === 1;
  }

  /** Get remaining TTL in seconds. Returns -2 if key missing, -1 if no expiry. */
  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  /** Atomically increment a key by 1. Returns the new value. */
  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  /** Atomically increment a key by a given amount. Returns the new value. */
  async incrBy(key: string, amount: number): Promise<number> {
    return this.client.incrby(key, amount);
  }

  /** Get multiple keys at once. Returns array of deserialized values (null for misses). */
  async mget<T>(keys: readonly string[]): Promise<readonly (T | null)[]> {
    if (keys.length === 0) {
      return [];
    }
    const results = await this.client.mget(...(keys as string[]));
    return results.map((raw: string | null) => {
      if (raw === null) {
        return null;
      }
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    });
  }

  /** Delete all keys matching a glob pattern using SCAN (never KEYS). Returns count deleted. */
  async delByPattern(pattern: string): Promise<number> {
    let cursor = '0';
    let deletedCount = 0;

    do {
      const result = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', SCAN_BATCH_SIZE);
      const nextCursor = result[0];
      const keys = result[1];
      cursor = nextCursor;

      if (keys.length > 0) {
        const count = await this.client.del(...keys);
        deletedCount += count;
      }
    } while (cursor !== '0');

    return deletedCount;
  }

  /** Health check. Returns true if Redis responds with PONG. */
  async ping(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  /** Push values to the head of a list. Returns the new list length. */
  async lpush(key: string, ...values: string[]): Promise<number> {
    return this.client.lpush(key, ...values);
  }

  /** Atomically move an element from one list to another. Returns the element or null. */
  async lmove(
    source: string,
    destination: string,
    from: 'LEFT' | 'RIGHT',
    to: 'LEFT' | 'RIGHT',
  ): Promise<string | null> {
    // ioredis types lmove as 4 exact-literal overloads; a union param doesn't match.

    return (this.client as any).lmove(source, destination, from, to) as Promise<string | null>;
  }

  /** Remove count occurrences of value from a list. Returns number removed. */
  async lrem(key: string, count: number, value: string): Promise<number> {
    return this.client.lrem(key, count, value);
  }

  /** Get the length of a list. */
  async llen(key: string): Promise<number> {
    return this.client.llen(key);
  }

  /** Get elements from a list by index range. */
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.lrange(key, start, stop);
  }

  /** SET with NX (only if not exists) and EX (TTL in seconds). Returns true if set. */
  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  /** Returns the underlying ioredis client for advanced operations. Use sparingly. */
  getClient(): Redis {
    return this.client;
  }
}
