import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash } from 'bcryptjs';
import { AuthService } from '../auth.service.js';
import {
  LOGIN_FAIL_PREFIX,
  LOGIN_FAIL_TTL_SECONDS,
  MAX_DELAY_SECONDS,
  REFRESH_TOKEN_PREFIX,
} from '../auth.constants.js';

interface FakeRedis {
  store: Map<string, unknown>;
  get<T>(key: string): Promise<T | null>;
  mget<T>(keys: readonly string[]): Promise<readonly (T | null)[]>;
  set(key: string, value: unknown, opts?: { ttlSeconds?: number }): Promise<void>;
  del(key: string): Promise<boolean>;
  incr(key: string): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<boolean>;
  lastSetTtl?: number;
  lastExpireTtl?: number;
}

function makeRedis(): FakeRedis {
  const store = new Map<string, unknown>();
  return {
    store,
    async get<T>(key: string) {
      return (store.get(key) as T | undefined) ?? null;
    },
    async mget<T>(keys) {
      return keys.map((k) => (store.get(k) as T | undefined) ?? null);
    },
    async set(key, value, opts) {
      store.set(key, value);
      this.lastSetTtl = opts?.ttlSeconds;
    },
    async del(key) {
      return store.delete(key);
    },
    async incr(key) {
      const current = (store.get(key) as number | undefined) ?? 0;
      const next = current + 1;
      store.set(key, next);
      return next;
    },
    async expire(key, ttlSeconds) {
      this.lastExpireTtl = ttlSeconds;
      return store.has(key);
    },
  };
}

const TEST_EMAIL = 'delay-test@example.com';
const VALID_EMAIL = 'valid@example.com';
const VALID_PASSWORD = 'correct-password';
const WRONG_PASSWORD = 'wrong-password';

async function buildService(redis: FakeRedis, validUserHash?: string): Promise<AuthService> {
  const prisma = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        if (where.email === VALID_EMAIL || where.id === 'user-1') {
          return {
            id: 'user-1',
            email: VALID_EMAIL,
            passwordHash: validUserHash,
            role: 'admin',
            isActive: true,
            policy: { name: 'Standard' },
          };
        }
        return null;
      }),
    },
  };
  const jwt = { sign: vi.fn(() => 'fake-jwt-token') };
  const config = {
    getOrThrow: vi.fn(() => 'test-secret'),
    get: vi.fn(() => '12'),
  };

  return new AuthService(
    prisma as never,
    jwt as unknown as JwtService,
    redis as never,
    config as unknown as ConfigService,
  );
}

describe('AuthService — progressive login delay', () => {
  let redis: FakeRedis;
  let service: AuthService;

  beforeEach(async () => {
    redis = makeRedis();
    service = await buildService(redis);
  });

  it('allows the first login attempt without delay (no Redis entry yet)', async () => {
    await expect(service.login(TEST_EMAIL, WRONG_PASSWORD)).rejects.toThrow('Invalid credentials');
  });

  it('records a failed attempt in Redis with count=1 after first failure', async () => {
    await service.login(TEST_EMAIL, WRONG_PASSWORD).catch(() => {});

    const count = await redis.get<number>(`${LOGIN_FAIL_PREFIX}${TEST_EMAIL}:count`);
    const ts = await redis.get<number>(`${LOGIN_FAIL_PREFIX}${TEST_EMAIL}:ts`);
    expect(count).toBe(1);
    expect(typeof ts).toBe('number');
  });

  it('persists the fail record with the configured TTL', async () => {
    await service.login(TEST_EMAIL, WRONG_PASSWORD).catch(() => {});
    expect(redis.lastExpireTtl).toBe(LOGIN_FAIL_TTL_SECONDS);
    expect(redis.lastSetTtl).toBe(LOGIN_FAIL_TTL_SECONDS);
  });

  it('atomically increments the count under concurrent failed attempts (no lost updates)', async () => {
    // Five concurrent failures must yield count=5, not <5. The previous
    // read-then-write impl would lose increments here.
    await Promise.all(
      Array.from({ length: 5 }, () => service.login(TEST_EMAIL, WRONG_PASSWORD).catch(() => {})),
    );
    const count = await redis.get<number>(`${LOGIN_FAIL_PREFIX}${TEST_EMAIL}:count`);
    expect(count).toBe(5);
  });

  it('throws TooManyRequests when retried immediately after a failure', async () => {
    await service.login(TEST_EMAIL, WRONG_PASSWORD).catch(() => {});

    await expect(service.login(TEST_EMAIL, WRONG_PASSWORD)).rejects.toThrow(/Try again in/);
  });

  it('increments fail count on subsequent failures (after the delay window)', async () => {
    // Seed an existing fail with lastAttempt in the past so the next attempt is allowed.
    await redis.set(`${LOGIN_FAIL_PREFIX}${TEST_EMAIL}:count`, 1, {
      ttlSeconds: LOGIN_FAIL_TTL_SECONDS,
    });
    await redis.set(`${LOGIN_FAIL_PREFIX}${TEST_EMAIL}:ts`, Date.now() - 5000, {
      ttlSeconds: LOGIN_FAIL_TTL_SECONDS,
    });

    await service.login(TEST_EMAIL, WRONG_PASSWORD).catch(() => {});

    const count = await redis.get<number>(`${LOGIN_FAIL_PREFIX}${TEST_EMAIL}:count`);
    expect(count).toBe(2);
  });

  it('caps the required delay at MAX_DELAY_SECONDS even with very high counts', async () => {
    // count=10 → 2^10 = 1024s, must be capped to MAX_DELAY_SECONDS (30s)
    await redis.set(`${LOGIN_FAIL_PREFIX}${TEST_EMAIL}:count`, 10, {
      ttlSeconds: LOGIN_FAIL_TTL_SECONDS,
    });
    await redis.set(
      `${LOGIN_FAIL_PREFIX}${TEST_EMAIL}:ts`,
      Date.now() - (MAX_DELAY_SECONDS - 5) * 1000,
      { ttlSeconds: LOGIN_FAIL_TTL_SECONDS },
    );

    // Still inside the 30s window → blocked
    await expect(service.login(TEST_EMAIL, WRONG_PASSWORD)).rejects.toThrow(/Try again in/);

    // Move just past the 30s cap
    await redis.set(
      `${LOGIN_FAIL_PREFIX}${TEST_EMAIL}:ts`,
      Date.now() - (MAX_DELAY_SECONDS + 1) * 1000,
      { ttlSeconds: LOGIN_FAIL_TTL_SECONDS },
    );

    // Now allowed (will fail with Invalid credentials, not TooManyRequests)
    await expect(service.login(TEST_EMAIL, WRONG_PASSWORD)).rejects.toThrow('Invalid credentials');
  });

  it('clears the fail record on a successful login', async () => {
    const validHash = await hash(VALID_PASSWORD, 4);
    service = await buildService(redis, validHash);

    await redis.set(`${LOGIN_FAIL_PREFIX}${VALID_EMAIL}:count`, 3, {
      ttlSeconds: LOGIN_FAIL_TTL_SECONDS,
    });
    await redis.set(`${LOGIN_FAIL_PREFIX}${VALID_EMAIL}:ts`, Date.now() - 60_000, {
      ttlSeconds: LOGIN_FAIL_TTL_SECONDS,
    });

    const tokens = await service.login(VALID_EMAIL, VALID_PASSWORD);
    expect(tokens.accessToken).toBeDefined();
    expect(tokens.refreshToken).toBeDefined();

    expect(await redis.get(`${LOGIN_FAIL_PREFIX}${VALID_EMAIL}:count`)).toBeNull();
    expect(await redis.get(`${LOGIN_FAIL_PREFIX}${VALID_EMAIL}:ts`)).toBeNull();
  });
});

describe('AuthService — refresh TOCTOU', () => {
  const INACTIVE_USER_ID = 'inactive-user-id';
  const TOKEN = 'tok-abc';

  it('does not delete the refresh token when the user is missing/inactive', async () => {
    const redis = makeRedis();
    redis.store.set(`${REFRESH_TOKEN_PREFIX}${TOKEN}`, INACTIVE_USER_ID);

    const prisma = {
      user: {
        findUnique: vi.fn(async () => null),
      },
    };
    const jwt = { sign: vi.fn(() => 'fake-jwt-token') };
    const config = {
      getOrThrow: vi.fn(() => 'test-secret'),
      get: vi.fn(() => '12'),
    };
    const service = new AuthService(
      prisma as never,
      jwt as unknown as JwtService,
      redis as never,
      config as unknown as ConfigService,
    );

    await expect(service.refresh(TOKEN)).rejects.toThrow('User not found or inactive');
    // Pre-fix: the token would already be gone. Post-fix: it survives so
    // the client can retry once the underlying user state is sorted out.
    expect(redis.store.has(`${REFRESH_TOKEN_PREFIX}${TOKEN}`)).toBe(true);
  });

  it('deletes the refresh token when the user is valid (happy path)', async () => {
    const redis = makeRedis();
    redis.store.set(`${REFRESH_TOKEN_PREFIX}${TOKEN}`, 'user-1');

    const prisma = {
      user: {
        findUnique: vi.fn(async () => ({
          id: 'user-1',
          email: 'a@b',
          role: 'admin',
          isActive: true,
          policy: { name: 'Standard' },
        })),
      },
    };
    const jwt = { sign: vi.fn(() => 'fake-jwt-token') };
    const config = {
      getOrThrow: vi.fn(() => 'test-secret'),
      get: vi.fn(() => '12'),
    };
    const service = new AuthService(
      prisma as never,
      jwt as unknown as JwtService,
      redis as never,
      config as unknown as ConfigService,
    );

    const tokens = await service.refresh(TOKEN);
    expect(tokens.accessToken).toBeDefined();
    // Old token revoked once the new pair was minted.
    expect(redis.store.has(`${REFRESH_TOKEN_PREFIX}${TOKEN}`)).toBe(false);
  });
});
