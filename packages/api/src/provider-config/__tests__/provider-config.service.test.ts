import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const TEST_KEY_HEX = 'a'.repeat(64);

vi.mock('../../common/crypto.js', () => ({
  encrypt: vi.fn((v: string) => `encrypted:${v}`),
  decrypt: vi.fn((v: string) => v.replace('encrypted:', '')),
  maskApiKey: vi.fn((v: string) => `sk-***...${v.slice(-4)}`),
}));

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

function createPrismaMock() {
  return {
    providerConfig: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
  };
}

import { ProviderConfigService } from '../provider-config.service.js';

describe('ProviderConfigService', () => {
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

  describe('resolveProvider', () => {
    it('returns decrypted key and baseUrl from DB when found', async () => {
      prisma.providerConfig.findUnique.mockResolvedValueOnce({
        id: 'cfg1',
        provider: 'anthropic',
        displayName: 'Anthropic',
        apiKey: 'encrypted:sk-ant-secret',
        apiBaseUrl: null,
        isEnabled: true,
        isDefault: true,
        sortOrder: 0,
      });

      const result = await service.resolveProvider('anthropic');
      expect(result.apiKey).toBe('sk-ant-secret');
      expect(result.apiBaseUrl).toBeNull();
    });

    it('falls back to env var when DB has no row', async () => {
      prisma.providerConfig.findUnique.mockResolvedValueOnce(null);
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-from-env');

      const result = await service.resolveProvider('anthropic');
      expect(result.apiKey).toBe('sk-from-env');
    });

    it('throws when neither DB nor env has the key', async () => {
      prisma.providerConfig.findUnique.mockResolvedValueOnce(null);
      vi.stubEnv('ANTHROPIC_API_KEY', '');

      await expect(service.resolveProvider('anthropic')).rejects.toThrow(
        /No provider config found/,
      );
    });

    it('throws when DB row is disabled', async () => {
      prisma.providerConfig.findUnique.mockResolvedValueOnce({
        provider: 'anthropic',
        isEnabled: false,
        apiKey: 'encrypted:key',
      });
      vi.stubEnv('ANTHROPIC_API_KEY', '');

      await expect(service.resolveProvider('anthropic')).rejects.toThrow(
        /No provider config found/,
      );
    });

    it('caches DB result and skips second query', async () => {
      prisma.providerConfig.findUnique.mockResolvedValue({
        provider: 'openai',
        apiKey: 'encrypted:sk-openai',
        apiBaseUrl: null,
        isEnabled: true,
      });

      await service.resolveProvider('openai');
      await service.resolveProvider('openai');
      expect(prisma.providerConfig.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe('findAll', () => {
    it('returns configs with masked API keys', async () => {
      prisma.providerConfig.findMany.mockResolvedValueOnce([
        {
          id: 'cfg1',
          provider: 'anthropic',
          displayName: 'Anthropic',
          apiKey: 'encrypted:sk-ant-secret1234',
          apiBaseUrl: null,
          isEnabled: true,
          isDefault: true,
          sortOrder: 0,
        },
      ]);

      const result = await service.findAll();
      expect(result).toHaveLength(1);
      expect(result[0]!.apiKey).toBe('sk-***...1234');
    });
  });

  describe('create', () => {
    it('encrypts API key before saving', async () => {
      prisma.providerConfig.count.mockResolvedValueOnce(0);
      prisma.providerConfig.create.mockResolvedValueOnce({
        id: 'cfg1',
        provider: 'zai-coding',
        displayName: 'Z.AI Coding Plan',
        apiKey: 'encrypted:sk-zai-key',
        apiBaseUrl: 'https://api.z.ai/api/coding/paas/v4',
        isEnabled: true,
        isDefault: false,
        sortOrder: 0,
      });

      await service.create({
        provider: 'zai-coding',
        displayName: 'Z.AI Coding Plan',
        apiKey: 'sk-zai-key',
        apiBaseUrl: 'https://api.z.ai/api/coding/paas/v4',
        isEnabled: true,
        isDefault: false,
        sortOrder: 0,
      });

      expect(prisma.providerConfig.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          apiKey: 'encrypted:sk-zai-key',
        }),
      });
    });

    it('clears other defaults when isDefault is true', async () => {
      prisma.providerConfig.count.mockResolvedValueOnce(1);
      prisma.providerConfig.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.providerConfig.create.mockResolvedValueOnce({
        id: 'cfg2',
        provider: 'openai',
        displayName: 'OpenAI',
        isDefault: true,
      });

      await service.create({
        provider: 'openai',
        displayName: 'OpenAI',
        apiKey: 'sk-key',
        isEnabled: true,
        isDefault: true,
        sortOrder: 0,
      });

      expect(prisma.providerConfig.updateMany).toHaveBeenCalledWith({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    });
  });

  describe('findByProvider', () => {
    it('returns masked config when provider is found', async () => {
      prisma.providerConfig.findUnique.mockResolvedValueOnce({
        id: 'cfg1',
        provider: 'anthropic',
        displayName: 'Anthropic',
        apiKey: 'encrypted:sk-ant-secret1234',
        apiBaseUrl: null,
        isEnabled: true,
        isDefault: true,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.findByProvider('anthropic');
      expect(result).not.toBeNull();
      expect(result!.provider).toBe('anthropic');
      expect(result!.apiKey).toBe('sk-***...1234');
    });

    it('returns null when provider is not found', async () => {
      prisma.providerConfig.findUnique.mockResolvedValueOnce(null);

      const result = await service.findByProvider('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('encrypts new API key when provided', async () => {
      prisma.providerConfig.updateMany.mockResolvedValueOnce({ count: 0 });
      prisma.providerConfig.update.mockResolvedValueOnce({
        id: 'cfg1',
        provider: 'anthropic',
        displayName: 'Anthropic',
        apiKey: 'encrypted:sk-new-key',
        apiBaseUrl: null,
        isEnabled: true,
        isDefault: false,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.update('anthropic', { apiKey: 'sk-new-key', isDefault: false });

      expect(prisma.providerConfig.update).toHaveBeenCalledWith({
        where: { provider: 'anthropic' },
        data: expect.objectContaining({ apiKey: 'encrypted:sk-new-key' }),
      });
    });

    it('clears other defaults when isDefault is true', async () => {
      prisma.providerConfig.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.providerConfig.update.mockResolvedValueOnce({
        id: 'cfg1',
        provider: 'openai',
        displayName: 'OpenAI',
        apiKey: 'encrypted:sk-openai',
        apiBaseUrl: null,
        isEnabled: true,
        isDefault: true,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.update('openai', { isDefault: true });

      expect(prisma.providerConfig.updateMany).toHaveBeenCalledWith({
        where: { isDefault: true, provider: { not: 'openai' } },
        data: { isDefault: false },
      });
    });

    it('invalidates cache so next resolveProvider hits DB', async () => {
      // Prime cache via resolveProvider
      prisma.providerConfig.findUnique.mockResolvedValueOnce({
        provider: 'anthropic',
        apiKey: 'encrypted:sk-old-key',
        apiBaseUrl: null,
        isEnabled: true,
      });
      await service.resolveProvider('anthropic');
      expect(prisma.providerConfig.findUnique).toHaveBeenCalledTimes(1);

      // Update invalidates the cache
      prisma.providerConfig.updateMany.mockResolvedValueOnce({ count: 0 });
      prisma.providerConfig.update.mockResolvedValueOnce({
        id: 'cfg1',
        provider: 'anthropic',
        displayName: 'Anthropic',
        apiKey: 'encrypted:sk-new-key',
        apiBaseUrl: null,
        isEnabled: true,
        isDefault: false,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await service.update('anthropic', { apiKey: 'sk-new-key' });

      // Second resolveProvider must re-query DB (cache was invalidated)
      prisma.providerConfig.findUnique.mockResolvedValueOnce({
        provider: 'anthropic',
        apiKey: 'encrypted:sk-new-key',
        apiBaseUrl: null,
        isEnabled: true,
      });
      const result = await service.resolveProvider('anthropic');
      expect(prisma.providerConfig.findUnique).toHaveBeenCalledTimes(2);
      expect(result.apiKey).toBe('sk-new-key');
    });
  });

  describe('remove', () => {
    it('deletes the provider config', async () => {
      prisma.providerConfig.delete.mockResolvedValueOnce({});

      await service.remove('anthropic');

      expect(prisma.providerConfig.delete).toHaveBeenCalledWith({
        where: { provider: 'anthropic' },
      });
    });

    it('invalidates cache so next resolveProvider falls back to env', async () => {
      // Prime cache via resolveProvider
      prisma.providerConfig.findUnique.mockResolvedValueOnce({
        provider: 'anthropic',
        apiKey: 'encrypted:sk-db-key',
        apiBaseUrl: null,
        isEnabled: true,
      });
      await service.resolveProvider('anthropic');
      expect(prisma.providerConfig.findUnique).toHaveBeenCalledTimes(1);

      // Remove invalidates cache
      prisma.providerConfig.delete.mockResolvedValueOnce({});
      await service.remove('anthropic');

      // After removal, resolveProvider should re-query DB (cache gone)
      // and then fall back to env
      prisma.providerConfig.findUnique.mockResolvedValueOnce(null);
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-from-env-fallback');

      const result = await service.resolveProvider('anthropic');
      expect(prisma.providerConfig.findUnique).toHaveBeenCalledTimes(2);
      expect(result.apiKey).toBe('sk-from-env-fallback');
    });
  });

  describe('seedFromEnv', () => {
    it('seeds provider configs from env vars when DB is empty', async () => {
      prisma.providerConfig.count.mockResolvedValueOnce(0);
      prisma.providerConfig.create.mockResolvedValue({});

      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-seed');
      vi.stubEnv('OPENAI_API_KEY', 'sk-openai-seed');
      vi.stubEnv('ZAI_CODING_API_KEY', '');
      vi.stubEnv('KIMI_CODE_API_KEY', '');
      vi.stubEnv('DEEPSEEK_API_KEY', '');

      await service.seedFromEnv();

      expect(prisma.providerConfig.create).toHaveBeenCalledTimes(2);

      // First created provider should be the default
      expect(prisma.providerConfig.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            provider: 'anthropic',
            displayName: 'Anthropic',
            apiKey: 'encrypted:sk-ant-seed',
            isDefault: true,
          }),
        }),
      );

      expect(prisma.providerConfig.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({
            provider: 'openai',
            displayName: 'OpenAI',
            apiKey: 'encrypted:sk-openai-seed',
            isDefault: false,
          }),
        }),
      );
    });

    it('seeds the deepseek provider with its default base URL when DEEPSEEK_API_KEY is set', async () => {
      prisma.providerConfig.count.mockResolvedValueOnce(0);
      prisma.providerConfig.create.mockResolvedValue({});

      vi.stubEnv('ANTHROPIC_API_KEY', '');
      vi.stubEnv('OPENAI_API_KEY', '');
      vi.stubEnv('ZAI_CODING_API_KEY', '');
      vi.stubEnv('KIMI_CODE_API_KEY', '');
      vi.stubEnv('DEEPSEEK_API_KEY', 'sk-deepseek-seed');

      await service.seedFromEnv();

      expect(prisma.providerConfig.create).toHaveBeenCalledTimes(1);
      expect(prisma.providerConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provider: 'deepseek',
            displayName: 'DeepSeek',
            apiKey: 'encrypted:sk-deepseek-seed',
            apiBaseUrl: 'https://api.deepseek.com',
            isDefault: true,
          }),
        }),
      );
    });

    it('skips seeding when DB already has rows', async () => {
      prisma.providerConfig.count.mockResolvedValueOnce(3);

      await service.seedFromEnv();

      expect(prisma.providerConfig.create).not.toHaveBeenCalled();
    });
  });

  describe('getDefaultProviderName', () => {
    it('returns the default provider name when one exists', async () => {
      prisma.providerConfig.findMany.mockResolvedValueOnce([
        {
          id: 'cfg1',
          provider: 'anthropic',
          isDefault: true,
          isEnabled: true,
        },
      ]);

      const result = await service.getDefaultProviderName();
      expect(result).toBe('anthropic');
      expect(prisma.providerConfig.findMany).toHaveBeenCalledWith({
        where: { isDefault: true, isEnabled: true },
        take: 1,
      });
    });

    it('returns null when no default provider is set', async () => {
      prisma.providerConfig.findMany.mockResolvedValueOnce([]);

      const result = await service.getDefaultProviderName();
      expect(result).toBeNull();
    });
  });
});
