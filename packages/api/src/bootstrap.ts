/**
 * Production bootstrap — seeds a minimal, idempotent initial state so a fresh
 * deployment is usable: org settings, policies, one admin user, provider
 * config(s), a primary agent, and the web channel.
 *
 * Differences from `prisma/seed.ts` (dev):
 *   - Never deletes existing rows. Every write is an upsert or guarded create.
 *   - Driven entirely by env vars; safe to invoke on every container start.
 *   - Silently exits 0 when INITIAL_ADMIN_EMAIL is not set.
 *
 * Invocation (inside the prod image): `node dist/bootstrap.js`
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import bcrypt from 'bcryptjs';
import { encrypt } from './common/crypto.js';
import { encryptChannelConfig } from './channels/channel-config-crypto.js';

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const adminEmail = process.env['INITIAL_ADMIN_EMAIL'];
const adminPassword = process.env['INITIAL_ADMIN_PASSWORD'];

if (!adminEmail || !adminPassword) {
  console.log(
    '[bootstrap] INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD not set — skipping bootstrap',
  );
  process.exit(0);
}

const adminName = process.env['INITIAL_ADMIN_NAME'] ?? 'Administrator';
const defaultProvider = process.env['DEFAULT_PROVIDER'] ?? 'openai';
const defaultModel = process.env['DEFAULT_LLM_MODEL'] ?? 'gpt-4o';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

interface ProviderSeed {
  readonly provider: string;
  readonly displayName: string;
  readonly envKey: string;
  readonly baseUrl?: string;
}

function buildProviderSeeds(): ProviderSeed[] {
  const seeds: ProviderSeed[] = [
    { provider: 'anthropic', displayName: 'Anthropic', envKey: 'ANTHROPIC_API_KEY' },
    { provider: 'openai', displayName: 'OpenAI', envKey: 'OPENAI_API_KEY' },
    {
      provider: 'zai-coding',
      displayName: 'Z.AI Coding Plan',
      envKey: 'ZAI_CODING_API_KEY',
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    },
  ];
  const customName = process.env['CUSTOM_PROVIDER_NAME'];
  const customBase = process.env['CUSTOM_PROVIDER_BASE_URL'];
  if (customName && customBase) {
    seeds.push({
      provider: customName,
      displayName: process.env['CUSTOM_PROVIDER_DISPLAY_NAME'] ?? customName,
      envKey: 'CUSTOM_PROVIDER_API_KEY',
      baseUrl: customBase,
    });
  }
  return seeds;
}

async function main(): Promise<void> {
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail! } });
  if (existingAdmin) {
    console.log(`[bootstrap] Admin ${adminEmail} already exists — nothing to do`);
    return;
  }

  console.log('[bootstrap] Bootstrapping initial admin and baseline config...');

  // --- SystemSettings (org identity; singleton) ---
  const system = await prisma.systemSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      name: 'Clawix',
      slug: 'clawix',
      settings: {
        defaultProvider,
        features: { memorySharing: true, swarmOrchestration: true },
      },
    },
  });
  console.log(`[bootstrap]   System: ${system.name}`);

  // --- Policies ---
  await prisma.policy.upsert({
    where: { name: 'Standard' },
    update: {},
    create: {
      name: 'Standard',
      description: 'Basic access with limited quotas',
      maxTokenBudget: 1000,
      maxAgents: 2,
      maxSkills: 5,
      maxMemoryItems: 100,
      maxGroupsOwned: 2,
      allowedProviders: ['openai'],
      cronEnabled: true,
      features: {},
    },
  });
  await prisma.policy.upsert({
    where: { name: 'Extended' },
    update: {},
    create: {
      name: 'Extended',
      description: 'Extended access with higher quotas',
      maxTokenBudget: 10000,
      maxAgents: 10,
      maxSkills: 50,
      maxMemoryItems: 5000,
      maxGroupsOwned: 10,
      allowedProviders: ['openai', 'anthropic'],
      cronEnabled: true,
      features: { swarmOrchestration: true },
    },
  });
  const unrestrictedPolicy = await prisma.policy.upsert({
    where: { name: 'Unrestricted' },
    update: {},
    create: {
      name: 'Unrestricted',
      description: 'Unlimited access for power users',
      maxTokenBudget: null,
      maxAgents: 100,
      maxSkills: 500,
      maxMemoryItems: 50000,
      maxGroupsOwned: 50,
      allowedProviders: ['openai', 'anthropic', 'azure', 'deepseek', 'gemini', 'zai-coding'],
      cronEnabled: true,
      features: { swarmOrchestration: true, heartbeat: true, customProviders: true },
    },
  });
  console.log('[bootstrap]   Policies: Standard, Extended, Unrestricted');

  // --- Providers (encrypted api keys; at least one required) ---
  // Validate before creating the admin so a misconfigured deployment fails
  // before writing user rows.
  const providerSeeds = buildProviderSeeds();
  const insertedProviders = new Set<string>();

  for (const seed of providerSeeds) {
    const apiKey = process.env[seed.envKey];
    if (!apiKey) continue;
    await prisma.providerConfig.upsert({
      where: { provider: seed.provider },
      update: {},
      create: {
        provider: seed.provider,
        displayName: seed.displayName,
        apiKey: encrypt(apiKey),
        apiBaseUrl: seed.baseUrl ?? null,
        isDefault: defaultProvider === seed.provider,
      },
    });
    insertedProviders.add(seed.provider);
  }

  if (insertedProviders.size === 0) {
    const envKeyList = providerSeeds.map((s) => s.envKey).join(', ');
    throw new Error(`No provider API keys found. Set at least one of: ${envKeyList}`);
  }

  if (!insertedProviders.has(defaultProvider)) {
    const seed = providerSeeds.find((s) => s.provider === defaultProvider);
    const hint = seed
      ? `Set ${seed.envKey} in your environment.`
      : `Add a provider entry for "${defaultProvider}" in bootstrap.ts.`;
    throw new Error(
      `DEFAULT_PROVIDER is "${defaultProvider}" but no API key was provided for it. ${hint}`,
    );
  }
  console.log(`[bootstrap]   Providers: ${[...insertedProviders].join(', ')}`);

  // --- Admin user ---
  const passwordHash = await bcrypt.hash(adminPassword!, 12);
  const admin = await prisma.user.create({
    data: {
      email: adminEmail!,
      name: adminName,
      passwordHash,
      role: 'admin',
      policyId: unrestrictedPolicy.id,
      isActive: true,
    },
  });
  console.log(`[bootstrap]   Admin: ${admin.name} <${admin.email}>`);

  // --- Primary agent (only if none exist) ---
  const existingPrimary = await prisma.agentDefinition.findFirst({ where: { role: 'primary' } });
  const primaryAgent =
    existingPrimary ??
    (await prisma.agentDefinition.create({
      data: {
        name: 'Primary Assistant',
        description: 'Default primary agent for users',
        systemPrompt: 'You are a helpful AI assistant.',
        role: 'primary',
        provider: defaultProvider,
        model: defaultModel,
        maxTokensPerRun: 100000,
        containerConfig: {
          image: 'clawix-agent:latest',
          cpuLimit: '1',
          memoryLimit: '512m',
          timeoutSeconds: 300,
          readOnlyRootfs: true,
          allowedMounts: [],
        },
        isActive: true,
      },
    }));
  console.log(`[bootstrap]   Primary agent: ${primaryAgent.name}`);

  // --- Bind admin to primary agent ---
  await prisma.userAgent.upsert({
    where: {
      userId_agentDefinitionId: {
        userId: admin.id,
        agentDefinitionId: primaryAgent.id,
      },
    },
    update: {},
    create: {
      userId: admin.id,
      agentDefinitionId: primaryAgent.id,
      workspacePath: `users/${admin.id}/workspace`,
    },
  });

  // --- Web channel (one must exist for the dashboard) ---
  const existingWeb = await prisma.channel.findFirst({ where: { type: 'web' } });
  if (!existingWeb) {
    await prisma.channel.create({
      data: {
        type: 'web',
        name: 'Web Dashboard',
        config: { enableProgress: true, enableToolHints: true },
        isActive: true,
      },
    });
    console.log('[bootstrap]   Web channel created');
  }

  // --- Telegram channel (optional) ---
  if (process.env['TELEGRAM_BOT_TOKEN']) {
    const existingTelegram = await prisma.channel.findFirst({ where: { type: 'telegram' } });
    if (!existingTelegram) {
      await prisma.channel.create({
        data: {
          type: 'telegram',
          name: 'Telegram Bot',
          config: encryptChannelConfig('telegram', {
            bot_token: process.env['TELEGRAM_BOT_TOKEN'],
          }) as Record<string, string>,
          isActive: true,
        },
      });
      console.log('[bootstrap]   Telegram channel created');
    }
  }

  console.log('[bootstrap] Done.');
}

main()
  .catch((error: unknown) => {
    console.error('[bootstrap] Failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
