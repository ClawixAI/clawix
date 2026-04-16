import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Controller, Get } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ThrottlerStorage } from '@nestjs/throttler';
import { NotFoundError, ValidationError } from '@clawix/shared';
import { Public } from '../auth/public.decorator.js';
import { AppModule } from '../app.module.js';
import { AppExceptionFilter } from '../filters/app-exception.filter.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../cache/redis.service.js';
import { RedisPubSubService } from '../cache/redis-pubsub.service.js';
import { ContainerPoolService } from '../engine/container-pool.service.js';

interface ErrorResponseBody {
  statusCode: number;
  code: string;
  message: string;
  details?: string[];
}

@Public()
@Controller('test')
class TestController {
  @Get('validation-error')
  throwValidation() {
    throw new ValidationError('bad input', ['name is required']);
  }

  @Get('not-found')
  throwNotFound() {
    throw new NotFoundError('Agent', 'abc-123');
  }

  @Get('unknown-error')
  throwUnknown() {
    throw new Error('unexpected');
  }
}

describe('App E2E', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env['JWT_SECRET'] = 'test-jwt-secret-for-e2e';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestController],
      providers: [
        {
          provide: APP_FILTER,
          useClass: AppExceptionFilter,
        },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: () => Promise.resolve(),
        $disconnect: () => Promise.resolve(),
        $queryRaw: () => Promise.resolve([{ '?column?': 1 }]),
        channel: {
          findMany: () =>
            Promise.resolve([
              {
                id: 'web-ch-seed',
                type: 'web',
                name: 'Web Dashboard',
                config: {},
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ]),
        },
        providerConfig: {
          count: () => Promise.resolve(1),
          findMany: () => Promise.resolve([]),
          findUnique: () => Promise.resolve(null),
        },
      })
      .overrideProvider(RedisService)
      .useValue({
        onModuleInit: () => Promise.resolve(),
        onModuleDestroy: () => Promise.resolve(),
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        del: () => Promise.resolve(),
        ping: () => Promise.resolve(true),
      })
      .overrideProvider(RedisPubSubService)
      .useValue({
        connect: () => Promise.resolve(),
        disconnect: () => Promise.resolve(),
        publish: () => Promise.resolve(),
        subscribe: () => Promise.resolve(),
      })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: () =>
          Promise.resolve({
            totalHits: 1,
            timeToExpire: 60,
            isBlocked: false,
            timeToBlockExpire: 0,
          }),
      })
      .overrideProvider(ContainerPoolService)
      .useValue({
        onModuleInit: () => Promise.resolve(),
        onModuleDestroy: () => Promise.resolve(),
        acquire: () => Promise.resolve('container-mock'),
        release: () => undefined,
        evict: () => Promise.resolve(),
        drainAll: () => Promise.resolve(),
        stats: () => ({ active: 0, idle: 0, ephemeral: 0, total: 0 }),
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env['JWT_SECRET'];
  });

  it('GET /health should return ok with dependency status', async () => {
    const result = await app.inject({ method: 'GET', url: '/health' });

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.payload);
    expect(body).toMatchObject({
      status: 'ok',
      info: {
        database: { status: 'up' },
        redis: { status: 'up' },
      },
    });
  });

  it('GET /health/live should return ok', async () => {
    const result = await app.inject({ method: 'GET', url: '/health/live' });

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.payload);
    expect(body).toMatchObject({ status: 'ok' });
  });

  it('GET /health/ready should return ok with dependency status', async () => {
    const result = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.payload);
    expect(body).toMatchObject({
      status: 'ok',
      info: {
        database: { status: 'up' },
        redis: { status: 'up' },
      },
    });
  });

  it('should return 422 for ValidationError', async () => {
    const result = await app.inject({
      method: 'GET',
      url: '/test/validation-error',
    });

    expect(result.statusCode).toBe(422);
    const body = JSON.parse(result.payload) as ErrorResponseBody;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.message).toBe('bad input');
    expect(body.details).toEqual(['name is required']);
  });

  it('should return 404 for NotFoundError', async () => {
    const result = await app.inject({
      method: 'GET',
      url: '/test/not-found',
    });

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.payload) as ErrorResponseBody;
    expect(body.code).toBe('NOT_FOUND');
  });

  it('should return 500 for unknown errors without leaking details', async () => {
    const result = await app.inject({
      method: 'GET',
      url: '/test/unknown-error',
    });

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.payload) as ErrorResponseBody;
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('Internal server error');
  });
});
