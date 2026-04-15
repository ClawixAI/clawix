/**
 * Prisma seed script — populates the database with development data.
 *
 * Run: pnpm exec prisma db seed
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { encrypt } from '../src/common/crypto.js';
import { encryptChannelConfig } from '../src/channels/channel-config-crypto.js';

// bcrypt hash of "password123" (12 salt rounds) — dev seed only
const DEV_PASSWORD_HASH = '$2b$12$kxtj.oI1arkJ9tfY8HcHXe2tVEwThcNLwimFy20PR6I2wmTSB8A.2';

dotenv.config({ path: path.join(import.meta.dirname, '..', '..', '..', '.env') });

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main(): Promise<void> {
  console.log('Seeding database...');

  // --- Clean previous seed data (allows safe re-seeding) ---
  // Delete in reverse dependency order; ON DELETE CASCADE handles children.
  console.log('  Cleaning previous seed data...');
  await prisma.auditLog.deleteMany({});
  await prisma.memoryShare.deleteMany({});
  await prisma.memoryItem.deleteMany({});
  await prisma.group.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.userAgent.deleteMany({});
  await prisma.channel.deleteMany({});
  await prisma.agentDefinition.deleteMany({});

  // --- System Settings (singleton — org identity + config) ---
  const system = await prisma.systemSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      name: 'Clawix',
      slug: 'clawix',
      settings: {
        defaultProvider: 'openai',
        features: { memorySharing: true, swarmOrchestration: true },
      },
    },
  });
  console.log(`  System: ${system.name}`);

  // --- Policies ---
  const standardPolicy = await prisma.policy.upsert({
    where: { name: 'Standard' },
    update: {},
    create: {
      name: 'Standard',
      description: 'Basic access with limited quotas',
      maxTokenBudget: 1000, // $10.00 in cents
      maxAgents: 2,
      maxSkills: 5,
      maxMemoryItems: 100,
      maxGroupsOwned: 2,
      allowedProviders: ['openai'],
      cronEnabled: true,
      features: {},
    },
  });
  console.log(`  Policy: ${standardPolicy.name}`);

  const extendedPolicy = await prisma.policy.upsert({
    where: { name: 'Extended' },
    update: {},
    create: {
      name: 'Extended',
      description: 'Extended access with higher quotas',
      maxTokenBudget: 10000, // $100.00 in cents
      maxAgents: 10,
      maxSkills: 50,
      maxMemoryItems: 5000,
      maxGroupsOwned: 10,
      allowedProviders: ['openai', 'anthropic'],
      cronEnabled: true,
      features: { swarmOrchestration: true },
    },
  });
  console.log(`  Policy: ${extendedPolicy.name}`);

  const unrestrictedPolicy = await prisma.policy.upsert({
    where: { name: 'Unrestricted' },
    update: {},
    create: {
      name: 'Unrestricted',
      description: 'Unlimited access for power users',
      maxTokenBudget: null, // unlimited
      maxAgents: 100,
      maxSkills: 500,
      maxMemoryItems: 50000,
      maxGroupsOwned: 50,
      allowedProviders: ['openai', 'anthropic', 'azure', 'deepseek', 'gemini'],
      cronEnabled: true,
      features: { swarmOrchestration: true, heartbeat: true, customProviders: true },
    },
  });
  console.log(`  Policy: ${unrestrictedPolicy.name}`);

  // --- Users ---
  const admin = await prisma.user.upsert({
    where: { email: 'admin@clawix.test' },
    update: {},
    create: {
      email: 'admin@clawix.test',
      name: 'Admin User',
      passwordHash: DEV_PASSWORD_HASH,
      role: 'admin',
      policyId: unrestrictedPolicy.id,
      telegramId: 'xxxxxxxx',
      isActive: true,
    },
  });
  console.log(`  User: ${admin.name} (${admin.role}, ${unrestrictedPolicy.name})`);

  const developer = await prisma.user.upsert({
    where: { email: 'dev@clawix.test' },
    update: {},
    create: {
      email: 'dev@clawix.test',
      name: 'Dev User',
      passwordHash: DEV_PASSWORD_HASH,
      role: 'developer',
      policyId: extendedPolicy.id,
      isActive: true,
    },
  });
  console.log(`  User: ${developer.name} (${developer.role}, ${extendedPolicy.name})`);

  const viewer = await prisma.user.upsert({
    where: { email: 'viewer@clawix.test' },
    update: {},
    create: {
      email: 'viewer@clawix.test',
      name: 'Viewer User',
      passwordHash: DEV_PASSWORD_HASH,
      role: 'viewer',
      policyId: standardPolicy.id,
      isActive: true,
    },
  });
  console.log(`  User: ${viewer.name} (${viewer.role}, ${standardPolicy.name})`);

  // --- Agent Definitions ---
  const primaryAgent = await prisma.agentDefinition.create({
    data: {
      name: 'Primary Assistant',
      description: 'Default primary agent for users',
      systemPrompt: 'You are a helpful AI assistant.',
      role: 'primary',
      provider: 'openai',
      model: 'gpt-4o',
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
  });
  console.log(`  Agent: ${primaryAgent.name} (primary, zai-coding/glm-4.7)`);

  const coderAgent = await prisma.agentDefinition.create({
    data: {
      name: 'coder',
      description: 'Writes, reviews, and tests code — optimized for code generation',
      systemPrompt:
        'You are a skilled software engineer. Write clean, complete, functional code. Never use placeholders or TODO comments. Always verify your output is complete. Use the tools available to read, write, and execute code in the workspace.',
      role: 'worker',
      provider: 'openai',
      model: 'gpt-4.1',
      maxTokensPerRun: 100000,
      containerConfig: {
        image: 'clawix-agent:latest',
        cpuLimit: '1',
        memoryLimit: '512m',
        timeoutSeconds: 300,
        readOnlyRootfs: false,
        allowedMounts: [],
      },
      isActive: true,
    },
  });
  console.log(`  Agent: ${coderAgent.name} (worker, openai/gpt-4o)`);

  const researcherAgent = await prisma.agentDefinition.create({
    data: {
      name: 'researcher',
      description: 'Searches the web and summarizes findings',
      systemPrompt:
        'You are a research specialist. Search the web for information, analyze sources, and provide clear, well-organized summaries with citations.',
      role: 'worker',
      provider: 'openai',
      model: 'gpt-4o',
      maxTokensPerRun: 50000,
      containerConfig: {
        image: 'clawix-agent:latest',
        cpuLimit: '0.5',
        memoryLimit: '256m',
        timeoutSeconds: 120,
        readOnlyRootfs: true,
        allowedMounts: [],
      },
      isActive: true,
    },
  });
  console.log(`  Agent: ${researcherAgent.name} (worker, openai/gpt-4o)`);

  const defaultWorker = await prisma.agentDefinition.create({
    data: {
      name: 'default-worker',
      description: 'Default worker agent for anonymous sub-agent tasks',
      systemPrompt: 'Complete the assigned task thoroughly and report the result.',
      role: 'worker',
      provider: 'openai',
      model: 'gpt-4o',
      maxTokensPerRun: 50000,
      containerConfig: {
        image: 'clawix-agent:latest',
        cpuLimit: '0.5',
        memoryLimit: '256m',
        timeoutSeconds: 300,
        readOnlyRootfs: false,
        allowedMounts: [],
      },
      isActive: true,
    },
  });
  console.log(`  Agent: ${defaultWorker.name} (worker, openai/gpt-4o)`);


  // --- User Agents (bind users to primary agent) ---
  await prisma.userAgent.create({
    data: {
      userId: admin.id,
      agentDefinitionId: primaryAgent.id,
      workspacePath: `users/${admin.id}/workspace`,
    },
  });

  await prisma.userAgent.create({
    data: {
      userId: developer.id,
      agentDefinitionId: primaryAgent.id,
      workspacePath: `users/${developer.id}/workspace`,
    },
  });
  console.log('  UserAgents: admin + developer bound to Primary Assistant');

  // --- Provider Configs (org-level) ---
  await prisma.providerConfig.upsert({
    where: { provider: 'openai' },
    update: {},
    create: {
      provider: 'openai',
      displayName: 'OpenAI',
      apiKey: encrypt('__OPENAI_API_KEY__'),
      isDefault: true,
    },
  });
  console.log('  Provider: openai (default)');

  await prisma.providerConfig.upsert({
    where: { provider: 'zai-coding' },
    update: {},
    create: {
      provider: 'zai-coding',
      displayName: 'Zai Coding',
      apiKey: encrypt('__ZAI_API_KEY__'),
      apiBaseUrl: 'https://api.z.ai/api/coding/paas/v4',
      isDefault: false,
    },
  });
  console.log('  Provider: zai-coding');

  // --- Channel ---
  const webChannel = await prisma.channel.create({
    data: {
      type: 'web',
      name: 'Web Dashboard',
      config: { enableProgress: true, enableToolHints: true },
      isActive: true,
    },
  });
  console.log(`  Channel: ${webChannel.name}`);

  const telegramChannel = await prisma.channel.create({
    data: {
      type: 'telegram',
      name: 'Telegram Bot',
      config: encryptChannelConfig('telegram', { bot_token: '__TELEGRAM_BOT_TOKEN__' }) as Record<string, string>,
      isActive: true,
    },
  });
  console.log(`  Channel: ${telegramChannel.name}`);

  // --- Group (memory sharing) ---
  const engineeringGroup = await prisma.group.create({
    data: {
      name: 'Engineering',
      description: 'Engineering team memory sharing group',
      createdById: admin.id,
      members: {
        create: [
          { userId: admin.id, role: 'OWNER' },
          { userId: developer.id, role: 'MEMBER' },
        ],
      },
    },
  });
  console.log(`  Group: ${engineeringGroup.name} (2 members)`);

  // --- Memory Items ---
  const memoryItem = await prisma.memoryItem.create({
    data: {
      ownerId: admin.id,
      content: {
        type: 'preference',
        text: 'Always use TypeScript strict mode. Prefer functional patterns over classes.',
      },
      tags: ['coding-standards', 'typescript'],
    },
  });

  // Share with engineering group
  await prisma.memoryShare.create({
    data: {
      memoryItemId: memoryItem.id,
      sharedBy: admin.id,
      targetType: 'GROUP',
      groupId: engineeringGroup.id,
    },
  });
  console.log('  Memory: 1 item shared with Engineering group');

  // --- Audit Log entry ---
  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: 'org.seed',
      resource: 'SystemSettings',
      resourceId: system.id,
      details: { source: 'seed-script', version: '1.0.0' },
    },
  });
  console.log('  AuditLog: seed event recorded');

  console.log('\nSeed complete.');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
