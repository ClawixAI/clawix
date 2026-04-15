#!/usr/bin/env node

/**
 * Clawix Installation Script
 *
 * Interactive setup: prerequisites check, configuration, build, and database seeding.
 * Designed for Linux and macOS. See install.sh for the bootstrapper.
 *
 * Usage: node scripts/install.mjs
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Paths ---
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENV_EXAMPLE = join(ROOT, '.env.example');
const ENV_FILE = join(ROOT, '.env');
const SEED_EXAMPLE = join(ROOT, 'packages', 'api', 'prisma', 'seed.example.ts');
const SEED_FILE = join(ROOT, 'packages', 'api', 'prisma', 'seed.ts');
const COMPOSE_FILE = join(ROOT, 'docker-compose.dev.yml');

// --- ANSI helpers ---
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

function ok(msg) {
  console.log(`  ${green('✓')} ${msg}`);
}
function warn(msg) {
  console.log(`  ${yellow('⚠')} ${msg}`);
}
function fail(msg) {
  console.error(`  ${red('✗')} ${msg}`);
}
function step(msg) {
  console.log(`\n${bold(cyan(`--- ${msg} ---`))}`);
}
function info(msg) {
  console.log(`  ${msg}`);
}

// --- Shell helpers ---
function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();
}

function runVisible(cmd) {
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

function commandExists(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// --- Postgres healthcheck poller ---
async function waitForPostgres(maxWaitSeconds = 60) {
  const start = Date.now();
  while (Date.now() - start < maxWaitSeconds * 1000) {
    try {
      execSync(
        `docker compose -f "${COMPOSE_FILE}" exec -T postgres pg_isready -U clawix`,
        { cwd: ROOT, stdio: 'ignore' },
      );
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return false;
}

// --- Graceful exit on Ctrl+C ---
process.on('SIGINT', () => {
  console.log('\n\nInstallation cancelled.');
  process.exit(130);
});

// =====================================================================
// Main
// =====================================================================
async function main() {
  const rl = createInterface({ input: stdin, output: stdout });

  console.log(`\n${bold('=== Clawix Installation ===')}\n`);

  // ==================================================================
  // 1. Prerequisites
  // ==================================================================
  step('Checking Prerequisites');

  // Node.js
  if (!commandExists('node')) {
    fail('Node.js is not installed. Run install.sh to bootstrap automatically.');
    process.exit(1);
  }
  const nodeVersion = run('node --version');
  const nodeMajor = parseInt(nodeVersion.replace('v', '').split('.')[0], 10);
  if (nodeMajor < 20) {
    fail(`Node.js 20+ required. Current: ${nodeVersion}`);
    process.exit(1);
  }
  ok(`Node.js ${nodeVersion}`);

  // pnpm
  if (!commandExists('pnpm')) {
    fail('pnpm is not installed. Run: corepack enable && corepack prepare pnpm@latest --activate');
    process.exit(1);
  }
  const pnpmVersion = run('pnpm --version');
  const pnpmMajor = parseInt(pnpmVersion.split('.')[0], 10);
  if (pnpmMajor < 9) {
    fail(`pnpm 9+ required. Current: ${pnpmVersion}`);
    process.exit(1);
  }
  ok(`pnpm ${pnpmVersion}`);

  // Docker
  if (!commandExists('docker')) {
    fail('Docker is not installed. Please install Docker first.');
    process.exit(1);
  }
  const dockerVersion = run('docker --version');
  ok(dockerVersion);

  // Docker Compose (v2 plugin)
  try {
    run('docker compose version');
    ok('Docker Compose available');
  } catch {
    fail('Docker Compose plugin not found. Install docker-compose-plugin.');
    process.exit(1);
  }

  // ==================================================================
  // 2. LLM Provider
  // ==================================================================
  step('LLM Provider');

  console.log('  Select your primary LLM provider:');
  console.log(`    ${bold('1)')} Anthropic (Claude)`);
  console.log(`    ${bold('2)')} OpenAI (GPT)`);

  let providerChoice;
  while (true) {
    providerChoice = (await rl.question('  Choice [1/2]: ')).trim();
    if (providerChoice === '1' || providerChoice === '2') break;
    warn('Please enter 1 or 2.');
  }

  const provider = providerChoice === '1' ? 'anthropic' : 'openai';
  const providerLabel = provider === 'anthropic' ? 'Anthropic (Claude)' : 'OpenAI (GPT)';
  const modelName = provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o';

  const keyPrompt =
    provider === 'anthropic'
      ? `  Enter your Anthropic API key (sk-ant-...): `
      : `  Enter your OpenAI API key (sk-...): `;

  let apiKey;
  while (true) {
    apiKey = (await rl.question(keyPrompt)).trim();
    if (apiKey.length > 0) break;
    warn('API key cannot be empty.');
  }

  ok(`Provider: ${providerLabel}`);

  // ==================================================================
  // 3. Channel Selection
  // ==================================================================
  step('Channel Selection');

  console.log(`  ${green('✓')} Web Interface ${dim('(always enabled)')}`);

  const enableTelegram =
    (await rl.question('  Enable Telegram? (y/N): ')).trim().toLowerCase() === 'y';

  console.log(`  ${dim('  WhatsApp — coming soon!')}`);

  const channels = ['web'];
  let telegramBotToken = '';
  let telegramId = '';

  if (enableTelegram) {
    channels.push('telegram');

    while (true) {
      telegramBotToken = (await rl.question('  Enter Telegram Bot Token: ')).trim();
      if (telegramBotToken.length > 0) break;
      warn('Bot token cannot be empty.');
    }

    while (true) {
      telegramId = (await rl.question('  Enter your Telegram ID (for admin user): ')).trim();
      if (telegramId.length > 0) break;
      warn('Telegram ID cannot be empty.');
    }

    ok('Telegram enabled');
  }

  // ==================================================================
  // 4. Admin User
  // ==================================================================
  step('Admin User');

  const adminEmail =
    (await rl.question(`  Admin email ${dim('[admin@clawix.test]')}: `)).trim() ||
    'admin@clawix.test';
  const adminName =
    (await rl.question(`  Admin name ${dim('[Admin User]')}: `)).trim() || 'Admin User';

  ok(`Admin: ${adminName} <${adminEmail}>`);

  // ==================================================================
  // 5. Confirmation
  // ==================================================================
  step('Configuration Summary');

  info(`Provider:  ${bold(providerLabel)} (model: ${modelName})`);
  info(`Channels:  ${bold(channels.join(', '))}`);
  info(`Admin:     ${bold(adminName)} <${adminEmail}>`);

  const proceed = (await rl.question(`\n  Proceed with installation? (Y/n): `)).trim().toLowerCase();
  if (proceed === 'n' || proceed === 'no') {
    console.log('\nInstallation cancelled.');
    rl.close();
    process.exit(0);
  }

  rl.close();

  // ==================================================================
  // 6. Configure .env
  // ==================================================================
  step('Configuring .env');

  if (existsSync(ENV_FILE)) {
    ok('.env already exists — skipping.');
  } else {
    let envContent = readFileSync(ENV_EXAMPLE, 'utf8');
    writeFileSync(ENV_FILE, envContent);
    ok('.env created from .env.example');
  }

  // ==================================================================
  // 7. Configure seed.ts
  // ==================================================================
  step('Configuring seed file');

  if (!existsSync(SEED_EXAMPLE)) {
    fail(`Seed template not found: ${SEED_EXAMPLE}`);
    process.exit(1);
  }

  if (existsSync(SEED_FILE)) {
    warn('seed.ts already exists — overwriting with new configuration.');
  }

  let seed = readFileSync(SEED_EXAMPLE, 'utf8');

  // --- Admin user ---
  seed = seed.replaceAll("'admin@clawix.test'", `'${adminEmail}'`);
  seed = seed.replace("'Admin User'", `'${adminName}'`);

  // --- Provider / model ---
  if (provider === 'anthropic') {
    // SystemSettings default provider
    seed = seed.replace("defaultProvider: 'openai'", "defaultProvider: 'anthropic'");
    // Agent definitions + ProviderConfig
    seed = seed.replaceAll("provider: 'openai'", "provider: 'anthropic'");
    seed = seed.replaceAll("model: 'gpt-4o'", `model: '${modelName}'`);
    // Console log strings
    seed = seed.replaceAll('openai/gpt-4o', `anthropic/${modelName}`);
    seed = seed.replace("'  Provider: openai (default)'", "'  Provider: anthropic (default)'");
    // Policy: standard gets primary provider
    seed = seed.replace("allowedProviders: ['openai']", "allowedProviders: ['anthropic']");
    // Policy: extended — primary first
    seed = seed.replace(
      "allowedProviders: ['openai', 'anthropic']",
      "allowedProviders: ['anthropic', 'openai']",
    );
  }

  // --- API keys (written directly into seed.ts instead of .env) ---
  // The __OPENAI_API_KEY__ placeholder is the primary provider key slot;
  // when Anthropic is selected, the provider field is already rewritten above.
  seed = seed.replace("'__OPENAI_API_KEY__'", `'${apiKey}'`);

  // --- Telegram ---
  if (enableTelegram) {
    seed = seed.replace("'__TELEGRAM_BOT_TOKEN__'", `'${telegramBotToken}'`);
    seed = seed.replace("telegramId: 'xxxxxxxx'", `telegramId: '${telegramId}'`);
  } else {
    // Remove telegramId from admin user
    seed = seed.replace(/\s*telegramId: 'xxxxxxxx',\n/, '\n');
    // Remove telegram channel creation block
    seed = seed.replace(
      /\n  const telegramChannel = await prisma\.channel\.create\(\{[\s\S]*?\}\);\n  console\.log\(`  Channel: \$\{telegramChannel\.name\}`\);/,
      '',
    );
  }

  writeFileSync(SEED_FILE, seed);
  ok('seed.ts configured');

  // ==================================================================
  // 8. Install dependencies
  // ==================================================================
  step('Installing dependencies (pnpm install)');
  runVisible('pnpm install');
  ok('Dependencies installed');

  // ==================================================================
  // 9. Build shared package
  // ==================================================================
  step('Building @clawix/shared');
  runVisible('pnpm --filter @clawix/shared run build');
  ok('Shared package built');

  // ==================================================================
  // 10. Build Docker agent image
  // ==================================================================
  step('Building Docker agent image');
  runVisible('docker build -t clawix-agent:latest -f infra/docker/agent/Dockerfile .');
  ok('Agent image built');

  // ==================================================================
  // 11. Start infrastructure
  // ==================================================================
  step('Starting infrastructure (Postgres, Redis, API, Web)');

  // Check for already-running containers and force-recreate to pick up new .env
  try {
    const psOutput = run(
      `docker compose -f "${COMPOSE_FILE}" ps -q`,
      { stdio: 'pipe' },
    );
    if (psOutput.length > 0) {
      warn('Existing containers detected — recreating with updated configuration.');
      runVisible(`docker compose -f "${COMPOSE_FILE}" up -d --force-recreate`);
    } else {
      runVisible('pnpm run docker:dev');
    }
  } catch {
    runVisible('pnpm run docker:dev');
  }
  ok('Docker containers started');

  info('Waiting for Postgres to be ready...');
  const pgReady = await waitForPostgres();
  if (!pgReady) {
    fail('Postgres did not become ready within 60 seconds.');
    info('Debug: docker compose -f docker-compose.dev.yml logs postgres');
    process.exit(1);
  }
  ok('Postgres is ready');

  // ==================================================================
  // 12. Database migrations
  // ==================================================================
  step('Running database migrations');
  runVisible('pnpm --filter @clawix/api exec prisma generate');
  runVisible('pnpm --filter @clawix/api exec prisma migrate deploy');
  ok('Migrations applied');

  // ==================================================================
  // 13. Seed database
  // ==================================================================
  step('Seeding database');
  runVisible('pnpm run db:seed');
  ok('Database seeded');

  // ==================================================================
  // 14. Restart API server (pick up seeded data)
  // ==================================================================
  step('Restarting API server');
  info('This may take a minute while the container reinitializes...');
  runVisible(`docker compose -f docker-compose.dev.yml restart api-server`);
  ok('API server restarted');

  // ==================================================================
  // Done
  // ==================================================================
  console.log(`\n${bold(green('=== Clawix Installation Complete! ==='))}\n`);

  console.log(`  ${bold('Services:')}`);
  console.log(`    API server:    ${cyan('http://localhost:3001')}`);
  console.log(`    Web dashboard: ${cyan('http://localhost:3000')}`);
  console.log(`    pgAdmin:       ${cyan('http://localhost:5050')}`);
  console.log(`    Postgres:      localhost:5433`);
  console.log(`    Redis:         localhost:6379`);

  console.log('');
  console.log(`  ${bold('Admin login:')}`);
  console.log(`    Email:    ${adminEmail}`);
  console.log(`    Password: password123 ${dim('(change in production!)')}`);

  if (enableTelegram) {
    console.log('');
    console.log(`  ${bold('Telegram:')}`);
    console.log(`    Bot token configured in seed.ts`);
    console.log(`    Admin Telegram ID: ${telegramId}`);
  }

  console.log('');
  console.log(`  ${bold('Useful commands:')}`);
  console.log(`    ${dim('pnpm run dev')}          Start dev servers (host-side, no Docker)`);
  console.log(`    ${dim('pnpm run docker:dev')}   Start Docker infrastructure`);
  console.log(`    ${dim('pnpm run docker:down')}  Stop Docker infrastructure`);
  console.log(`    ${dim('pnpm run test')}         Run tests`);
  console.log(`    ${dim('pnpm run db:studio')}    Open Prisma Studio`);
  console.log('');
}

main().catch((err) => {
  fail('Installation failed:');
  console.error(err);
  process.exit(1);
});
