import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { hash } from 'bcryptjs';
import cookie from '@fastify/cookie';
import { AuthController } from '../auth/auth.controller.js';
import { AuthService } from '../auth/auth.service.js';
import { JwtStrategy } from '../auth/jwt.strategy.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../cache/redis.service.js';
import { AppExceptionFilter } from '../filters/app-exception.filter.js';

const TEST_SECRET = 'test-jwt-secret-for-integration-tests';
const TEST_USER_ID = 'user-auth-test-1';
const TEST_EMAIL = 'test@example.com';
const TEST_PASSWORD = 'correct-password';

describe('Auth Integration', () => {
  let app: NestFastifyApplication;
  let passwordHash: string;
  const redisStore = new Map<string, string>();

  beforeAll(async () => {
    passwordHash = await hash(TEST_PASSWORD, 4);

    const mockPrisma = {
      user: {
        findUnique: ({ where }: { where: { email?: string; id?: string } }) => {
          if (where.email === TEST_EMAIL || where.id === TEST_USER_ID) {
            return Promise.resolve({
              id: TEST_USER_ID,
              email: TEST_EMAIL,
              passwordHash,
              role: 'admin',
              isActive: true,
              policy: { name: 'Extended' },
            });
          }
          return Promise.resolve(null);
        },
      },
    };

    const mockRedis = {
      get: (key: string) => Promise.resolve(redisStore.get(key) ?? null),
      mget: (keys: readonly string[]) =>
        Promise.resolve(keys.map((k) => redisStore.get(k) ?? null)),
      set: (key: string, value: string) => {
        redisStore.set(key, value);
        return Promise.resolve();
      },
      del: (key: string) => {
        redisStore.delete(key);
        return Promise.resolve();
      },
      incr: (key: string) => {
        const current = Number(redisStore.get(key) ?? 0);
        const next = current + 1;
        redisStore.set(key, String(next));
        return Promise.resolve(next);
      },
      expire: (_key: string, _ttlSeconds: number) => Promise.resolve(true),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              JWT_SECRET: TEST_SECRET,
              BCRYPT_SALT_ROUNDS: '4',
            }),
          ],
        }),
        PassportModule,
        JwtModule.register({}),
      ],
      controllers: [AuthController],
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        AuthService,
        JwtStrategy,
        { provide: APP_FILTER, useClass: AppExceptionFilter },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    // Register @fastify/cookie so reply.setCookie / req.cookies work in
    // the auth controller. Production registers this in security.config.ts;
    // the integration test must do it explicitly since it skips main
    // bootstrap.
    await app.getHttpAdapter().getInstance().register(cookie);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => {
    // Reset the in-memory Redis store between tests so leftover login_fail
    // counters or refresh tokens from one test don't affect the next.
    redisStore.clear();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('POST /auth/login with valid credentials → 200 + tokens', async () => {
    const result = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.payload);
    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('refreshToken');
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
  });

  it('POST /auth/login with unknown email → 401', async () => {
    const result = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody@example.com', password: 'anything' },
    });

    expect(result.statusCode).toBe(401);
  });

  it('POST /auth/login with wrong password → 401', async () => {
    const result = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: TEST_EMAIL, password: 'wrong-password' },
    });

    expect(result.statusCode).toBe(401);
  });

  it('POST /auth/login with invalid body (missing email) → 422', async () => {
    const result = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { password: 'anything' },
    });

    expect(result.statusCode).toBe(422);
    const body = JSON.parse(result.payload);
    expect(body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'email' })]),
    );
  });

  it('POST /auth/login with empty body → 422', async () => {
    const result = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {},
    });

    expect(result.statusCode).toBe(422);
  });

  it('POST /auth/refresh with valid token → 200 + new token pair', async () => {
    const loginResult = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });
    const { refreshToken } = JSON.parse(loginResult.payload);

    const result = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    });

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.payload);
    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('refreshToken');
    expect(body.refreshToken).not.toBe(refreshToken);
  });

  it('POST /auth/refresh with invalid token → 401', async () => {
    const result = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'invalid-token-value' },
    });

    expect(result.statusCode).toBe(401);
  });

  it('POST /auth/logout with valid token → 204', async () => {
    const loginResult = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });
    const { refreshToken } = JSON.parse(loginResult.payload);

    const result = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: { refreshToken },
    });

    expect(result.statusCode).toBe(204);

    // Token should be revoked — refresh should fail
    const refreshResult = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    });
    expect(refreshResult.statusCode).toBe(401);
  });
});
