import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const TEST_KEY_HEX = 'ab'.repeat(32);

vi.mock('@clawix/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clawix/shared')>();
  return {
    ...actual,
    createLogger: vi.fn().mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

import { ProviderConfigService } from '../provider-config.service.js';

function createPrismaMock() {
  const store = new Map<string, Record<string, unknown>>();
  return {
    providerConfig: {
      findUnique: vi.fn(({ where }: { where: { provider: string } }) => {
        return Promise.resolve(store.get(where.provider) ?? null);
      }),
      findMany: vi.fn(() => Promise.resolve([...store.values()])),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        store.set(data['provider'] as string, {
          ...data,
          id: 'test-id',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        return Promise.resolve(store.get(data['provider'] as string));
      }),
      update: vi.fn(
        ({ where, data }: { where: { provider: string }; data: Record<string, unknown> }) => {
          const existing = store.get(where.provider);
          const updated = { ...existing, ...data, updatedAt: new Date() };
          store.set(where.provider, updated);
          return Promise.resolve(updated);
        },
      ),
      delete: vi.fn(({ where }: { where: { provider: string } }) => {
        store.delete(where.provider);
        return Promise.resolve({});
      }),
      updateMany: vi.fn(() => Promise.resolve({ count: 0 })),
      count: vi.fn(() => Promise.resolve(store.size)),
    },
    _store: store,
  };
}

describe('ProviderConfig integration', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: ProviderConfigService;

  beforeEach(() => {
    vi.stubEnv('PROVIDER_ENCRYPTION_KEY', TEST_KEY_HEX);
    prisma = createPrismaMock();
    service = new ProviderConfigService(prisma as any);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('full lifecycle: create → resolve → update → resolve new value', async () => {
    await service.create({
      provider: 'anthropic',
      displayName: 'Anthropic',
      apiKey: 'sk-ant-original',
      isEnabled: true,
      isDefault: false,
      sortOrder: 0,
    });

    const resolved1 = await service.resolveProvider('anthropic');
    expect(resolved1.apiKey).toBe('sk-ant-original');

    await service.update('anthropic', { apiKey: 'sk-ant-updated' });

    const resolved2 = await service.resolveProvider('anthropic');
    expect(resolved2.apiKey).toBe('sk-ant-updated');
  });

  it('delete removes config and resolution falls back to env', async () => {
    await service.create({
      provider: 'openai',
      displayName: 'OpenAI',
      apiKey: 'sk-openai-key',
      isEnabled: true,
      isDefault: false,
      sortOrder: 0,
    });

    await service.remove('openai');
    vi.stubEnv('OPENAI_API_KEY', 'sk-from-env');

    const resolved = await service.resolveProvider('openai');
    expect(resolved.apiKey).toBe('sk-from-env');
  });
});
