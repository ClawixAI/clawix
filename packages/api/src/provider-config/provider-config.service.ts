import { Injectable } from '@nestjs/common';
import { createLogger, findProviderByName } from '@clawix/shared';
import type { CreateProviderConfigInput, UpdateProviderConfigInput } from '@clawix/shared';

import { PrismaService } from '../prisma/prisma.service.js';
import { encrypt, decrypt, maskApiKey } from '../common/crypto.js';

const logger = createLogger('provider-config');

const CACHE_TTL_MS = 60_000;

interface CachedEntry {
  readonly apiKey: string;
  readonly apiBaseUrl: string | null;
  readonly expiresAt: number;
}

export interface MaskedProviderConfig {
  readonly id: string;
  readonly provider: string;
  readonly displayName: string;
  readonly apiKey: string; // masked
  readonly apiBaseUrl: string | null;
  readonly isEnabled: boolean;
  readonly isDefault: boolean;
  readonly sortOrder: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface ResolvedProvider {
  readonly apiKey: string;
  readonly apiBaseUrl: string | null;
}

@Injectable()
export class ProviderConfigService {
  private readonly cache = new Map<string, CachedEntry>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve credentials for a provider.
   * Priority: DB (enabled) → env var fallback → error.
   */
  async resolveProvider(providerName: string): Promise<ResolvedProvider> {
    // Check cache first
    const cached = this.cache.get(providerName);
    if (cached && cached.expiresAt > Date.now()) {
      return { apiKey: cached.apiKey, apiBaseUrl: cached.apiBaseUrl };
    }

    // Query DB
    const config = await this.prisma.providerConfig.findUnique({
      where: { provider: providerName },
    });

    if (config && config.isEnabled) {
      const decryptedKey = decrypt(config.apiKey);
      this.cache.set(providerName, {
        apiKey: decryptedKey,
        apiBaseUrl: config.apiBaseUrl,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return { apiKey: decryptedKey, apiBaseUrl: config.apiBaseUrl };
    }

    // Env var fallback
    const spec = findProviderByName(providerName);
    const envKey = spec?.envKey ?? `${providerName.toUpperCase().replace(/-/g, '_')}_API_KEY`;
    const envValue = process.env[envKey];
    if (envValue) {
      logger.debug({ providerName, envKey }, 'Resolved provider from env var (DB miss)');
      return { apiKey: envValue, apiBaseUrl: null };
    }

    throw new Error(
      `No provider config found for "${providerName}". ` +
        `Add it via the admin API or set the ${envKey} environment variable.`,
    );
  }

  /**
   * Return the default provider name, or null if none is set.
   */
  async getDefaultProviderName(): Promise<string | null> {
    const config = await this.prisma.providerConfig.findMany({
      where: { isDefault: true, isEnabled: true },
      take: 1,
    });
    return config[0]?.provider ?? null;
  }

  /**
   * List all provider configs with masked API keys.
   */
  async findAll(): Promise<readonly MaskedProviderConfig[]> {
    const configs = await this.prisma.providerConfig.findMany({
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
    });

    return configs.map((c) => {
      let maskedKey: string;
      try {
        maskedKey = maskApiKey(decrypt(c.apiKey));
      } catch {
        maskedKey = '****';
      }
      return { ...c, apiKey: maskedKey };
    });
  }

  /**
   * Get a single provider config by provider name (masked key).
   */
  async findByProvider(providerName: string): Promise<MaskedProviderConfig | null> {
    const config = await this.prisma.providerConfig.findUnique({
      where: { provider: providerName },
    });

    if (!config) return null;

    let maskedKey: string;
    try {
      maskedKey = maskApiKey(decrypt(config.apiKey));
    } catch {
      maskedKey = '****';
    }
    return { ...config, apiKey: maskedKey };
  }

  /**
   * Create a new provider config. Encrypts the API key before storing.
   */
  async create(input: CreateProviderConfigInput): Promise<MaskedProviderConfig> {
    if (input.isDefault) {
      const existingDefaults = await this.prisma.providerConfig.count({
        where: { isDefault: true },
      });
      if (existingDefaults > 0) {
        await this.prisma.providerConfig.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }
    }

    const config = await this.prisma.providerConfig.create({
      data: {
        provider: input.provider,
        displayName: input.displayName,
        apiKey: encrypt(input.apiKey),
        apiBaseUrl: input.apiBaseUrl ?? null,
        isEnabled: input.isEnabled ?? true,
        isDefault: input.isDefault ?? false,
        sortOrder: input.sortOrder ?? 0,
      },
    });

    this.invalidateCache(config.provider);
    logger.info({ provider: config.provider }, 'Provider config created');
    return { ...config, apiKey: maskApiKey(input.apiKey) };
  }

  /**
   * Update an existing provider config.
   */
  async update(
    providerName: string,
    input: UpdateProviderConfigInput,
  ): Promise<MaskedProviderConfig> {
    if (input.isDefault === true) {
      await this.prisma.providerConfig.updateMany({
        where: { isDefault: true, provider: { not: providerName } },
        data: { isDefault: false },
      });
    }

    const data: Record<string, unknown> = { ...input };
    if (input.apiKey) {
      data['apiKey'] = encrypt(input.apiKey);
    }

    const config = await this.prisma.providerConfig.update({
      where: { provider: providerName },
      data,
    });

    this.invalidateCache(providerName);
    logger.info({ provider: providerName }, 'Provider config updated');

    const maskedKey = input.apiKey
      ? maskApiKey(input.apiKey)
      : maskApiKey(decrypt(config.apiKey));

    return { ...config, apiKey: maskedKey };
  }

  /**
   * Delete a provider config.
   */
  async remove(providerName: string): Promise<void> {
    await this.prisma.providerConfig.delete({
      where: { provider: providerName },
    });
    this.invalidateCache(providerName);
    logger.info({ provider: providerName }, 'Provider config deleted');
  }

  /**
   * Auto-seed DB from env vars on first boot.
   * Only runs when the ProviderConfig table is empty.
   */
  async seedFromEnv(): Promise<void> {
    const count = await this.prisma.providerConfig.count();
    if (count > 0) {
      logger.debug('Provider configs already exist in DB, skipping env seed');
      return;
    }

    const seedMap: readonly { provider: string; displayName: string; envKey: string }[] = [
      { provider: 'anthropic', displayName: 'Anthropic', envKey: 'ANTHROPIC_API_KEY' },
      { provider: 'openai', displayName: 'OpenAI', envKey: 'OPENAI_API_KEY' },
      { provider: 'zai-coding', displayName: 'Z.AI Coding Plan', envKey: 'ZAI_CODING_API_KEY' },
    ];

    let isFirst = true;
    for (const { provider, displayName, envKey } of seedMap) {
      const apiKey = process.env[envKey];
      if (apiKey) {
        const spec = findProviderByName(provider);
        await this.prisma.providerConfig.create({
          data: {
            provider,
            displayName,
            apiKey: encrypt(apiKey),
            apiBaseUrl: spec?.defaultBaseUrl ?? null,
            isEnabled: true,
            isDefault: isFirst,
            sortOrder: 0,
          },
        });
        logger.info({ provider, envKey }, 'Seeded provider config from env var');
        isFirst = false;
      }
    }
  }

  private invalidateCache(providerName: string): void {
    this.cache.delete(providerName);
  }
}
