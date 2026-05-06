import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash } from 'bcryptjs';
import { AuthService } from '../auth.service.js';
import { LOGIN_FAIL_PREFIX, LOGIN_FAIL_TTL_SECONDS, MAX_DELAY_SECONDS } from '../auth.constants.js';

interface FailRecord {
  count: number;
  lastAttempt: number;
}

interface FakeRedis {
  store: Map<string, unknown>;
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ttlSeconds?: number }): Promise<void>;
  del(key: string): Promise<boolean>;
  lastSetTtl?: number;
}

function makeRedis(): FakeRedis {
  const store = new Map<string, unknown>();
  return {
    store,
    async get<T>(key: string) {
      return (store.get(key) as T | undefined) ?? null;
    },
    async set(key, value, opts) {
      store.set(key, value);
      this.lastSetTtl = opts?.ttlSeconds;
    },
    async del(key) {
      return store.delete(key);
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

    const failData = (await redis.get<FailRecord>(`${LOGIN_FAIL_PREFIX}${TEST_EMAIL}`)) ?? null;
    expect(failData).not.toBeNull();
    expect(failData?.count).toBe(1);
    expect(failData?.lastAttempt).toBeTypeOf('number');
  });

  it('persists the fail record with the configured TTL', async () => {
    await service.login(TEST_EMAIL, WRONG_PASSWORD).catch(() => {});
    expect(redis.lastSetTtl).toBe(LOGIN_FAIL_TTL_SECONDS);
  });

  it('throws TooManyRequests when retried immediately after a failure', async () => {
    await service.login(TEST_EMAIL, WRONG_PASSWORD).catch(() => {});

    await expect(service.login(TEST_EMAIL, WRONG_PASSWORD)).rejects.toThrow(/Try again in/);
  });

  it('increments fail count on subsequent failures (after the delay window)', async () => {
    // Seed an existing fail with lastAttempt in the past so the next attempt is allowed.
    await redis.set(
      `${LOGIN_FAIL_PREFIX}${TEST_EMAIL}`,
      { count: 1, lastAttempt: Date.now() - 5000 },
      { ttlSeconds: LOGIN_FAIL_TTL_SECONDS },
    );

    await service.login(TEST_EMAIL, WRONG_PASSWORD).catch(() => {});

    const failData = await redis.get<FailRecord>(`${LOGIN_FAIL_PREFIX}${TEST_EMAIL}`);
    expect(failData?.count).toBe(2);
  });

  it('caps the required delay at MAX_DELAY_SECONDS even with very high counts', async () => {
    // count=10 → 2^10 = 1024s, must be capped to MAX_DELAY_SECONDS (30s)
    await redis.set(
      `${LOGIN_FAIL_PREFIX}${TEST_EMAIL}`,
      { count: 10, lastAttempt: Date.now() - (MAX_DELAY_SECONDS - 5) * 1000 },
      { ttlSeconds: LOGIN_FAIL_TTL_SECONDS },
    );

    // Still inside the 30s window → blocked
    await expect(service.login(TEST_EMAIL, WRONG_PASSWORD)).rejects.toThrow(/Try again in/);

    // Move just past the 30s cap
    await redis.set(
      `${LOGIN_FAIL_PREFIX}${TEST_EMAIL}`,
      { count: 10, lastAttempt: Date.now() - (MAX_DELAY_SECONDS + 1) * 1000 },
      { ttlSeconds: LOGIN_FAIL_TTL_SECONDS },
    );

    // Now allowed (will fail with Invalid credentials, not TooManyRequests)
    await expect(service.login(TEST_EMAIL, WRONG_PASSWORD)).rejects.toThrow('Invalid credentials');
  });

  it('clears the fail record on a successful login', async () => {
    const validHash = await hash(VALID_PASSWORD, 4);
    service = await buildService(redis, validHash);

    await redis.set(
      `${LOGIN_FAIL_PREFIX}${VALID_EMAIL}`,
      { count: 3, lastAttempt: Date.now() - 60_000 },
      { ttlSeconds: LOGIN_FAIL_TTL_SECONDS },
    );

    const tokens = await service.login(VALID_EMAIL, VALID_PASSWORD);
    expect(tokens.accessToken).toBeDefined();
    expect(tokens.refreshToken).toBeDefined();

    const failData = await redis.get(`${LOGIN_FAIL_PREFIX}${VALID_EMAIL}`);
    expect(failData).toBeNull();
  });
});
