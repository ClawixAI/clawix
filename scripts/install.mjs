#!/usr/bin/env node

/**
 * Clawix Installer (first-run, interactive)
 *
 * Generates a ready-to-run `.env` (secrets + admin + provider), builds the
 * agent image, and starts the stack. All database setup (migrations + admin
 * bootstrap) happens inside the api container on first start — see
 * `infra/docker/api/entrypoint.sh` and `dist/bootstrap.js`.
 *
 * Re-running is safe: existing `.env` is preserved. For routine
 * restart/rebuild, use `scripts/update.mjs` instead.
 *
 * Usage: node scripts/install.mjs
 */

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { stdin, stdout } from 'node:process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENV_EXAMPLE = join(ROOT, '.env.example');
const ENV_FILE = join(ROOT, '.env');
const COMPOSE_PROD = join(ROOT, 'docker-compose.prod.yml');
const COMPOSE_DEV = join(ROOT, 'docker-compose.dev.yml');

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

const ok = (m) => console.log(`  ${green('✓')} ${m}`);
const warn = (m) => console.log(`  ${yellow('⚠')} ${m}`);
const fail = (m) => console.error(`  ${red('✗')} ${m}`);
const info = (m) => console.log(`  ${m}`);
const step = (m) => console.log(`\n${bold(cyan(`--- ${m} ---`))}`);

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();
}
function runVisible(cmd) {
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}
function commandExists(cmd) {
  const r = spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
  return r.status === 0;
}
function secret(bytes) {
  return randomBytes(bytes).toString('hex');
}

function upsertEnvLine(content, key, value) {
  const safe = String(value).replace(/\r?\n/g, ' ');
  const pattern = new RegExp(`^\\s*#?\\s*${key}=.*$`, 'm');
  if (pattern.test(content)) {
    return content.replace(pattern, `${key}=${safe}`);
  }
  return content.replace(/\s*$/, '') + `\n${key}=${safe}\n`;
}

async function waitForHealth(url, timeoutSeconds) {
  const start = Date.now();
  while (Date.now() - start < timeoutSeconds * 1000) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

process.on('SIGINT', () => {
  console.log('\n\nInstallation cancelled.');
  process.exit(130);
});

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  const ask = (q) => rl.question(q);

  console.log(`\n${bold('=== Clawix Installer ===')}\n`);

  step('Checking prerequisites');

  if (!commandExists('node')) {
    fail('Node.js is not installed.');
    process.exit(1);
  }
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < 20) {
    fail(`Node.js 20+ required. Current: v${process.versions.node}`);
    process.exit(1);
  }
  ok(`Node.js v${process.versions.node}`);

  if (!commandExists('pnpm')) {
    fail('pnpm is not installed. Run: corepack enable && corepack prepare pnpm@latest --activate');
    process.exit(1);
  }
  ok(`pnpm ${run('pnpm --version')}`);

  if (!commandExists('docker')) {
    fail('Docker is not installed.');
    process.exit(1);
  }
  ok(run('docker --version'));

  try {
    run('docker compose version');
    ok('Docker Compose plugin available');
  } catch {
    fail('Docker Compose v2 plugin not found. Install docker-compose-plugin.');
    process.exit(1);
  }

  step('Deployment mode');
  console.log('  1) Production  (built images, bootstrap runs in-container)');
  console.log('  2) Development (hot-reload, source mounts)');
  let mode = (await ask('  Choice [1/2] (default: 1): ')).trim() || '1';
  while (mode !== '1' && mode !== '2') {
    warn('Please enter 1 or 2.');
    mode = (await ask('  Choice [1/2]: ')).trim();
  }
  const deployMode = mode === '1' ? 'production' : 'development';
  const composeFile = deployMode === 'production' ? COMPOSE_PROD : COMPOSE_DEV;
  ok(`${deployMode} — ${composeFile.replace(ROOT + '/', '')}`);

  // Short-circuit if .env exists: we don't re-prompt or overwrite secrets.
  const envExists = existsSync(ENV_FILE);
  if (envExists) {
    warn('.env already exists — keeping existing secrets and configuration.');
    info(`To reconfigure from scratch, delete ${ENV_FILE} and re-run this script.`);
  }

  let answers = null;
  if (!envExists) {
    step('Providers');
    console.log('  Select one or more LLM providers (comma-separated, e.g. 1,2).');
    console.log('  1) Anthropic           (default model: claude-sonnet-4-5)');
    console.log('  2) OpenAI              (default model: gpt-4o)');
    console.log('  3) Z.AI Coding Plan    (default model: glm-4.7)');
    console.log('  4) Custom              (any OpenAI-compatible endpoint — local LLM, OpenRouter, vLLM, etc.)');

    /** Catalog of built-in providers. Mirrors packages/shared/src/providers/provider-registry.ts. */
    const CATALOG = {
      1: {
        id: 'anthropic',
        displayName: 'Anthropic',
        envKey: 'ANTHROPIC_API_KEY',
        defaultModel: 'claude-sonnet-4-5',
      },
      2: {
        id: 'openai',
        displayName: 'OpenAI',
        envKey: 'OPENAI_API_KEY',
        defaultModel: 'gpt-4o',
      },
      3: {
        id: 'zai-coding',
        displayName: 'Z.AI Coding Plan',
        envKey: 'ZAI_CODING_API_KEY',
        defaultModel: 'glm-4.7',
      },
    };

    /** Parse "1,3,4" → unique ordered list of integers from `valid`. */
    function parseSelection(input, valid) {
      const seen = new Set();
      const out = [];
      for (const raw of input.split(',')) {
        const n = Number.parseInt(raw.trim(), 10);
        if (Number.isNaN(n) || !valid.includes(n) || seen.has(n)) return null;
        seen.add(n);
        out.push(n);
      }
      return out.length > 0 ? out : null;
    }

    let selection;
    while (true) {
      const raw = (await ask('  Selection: ')).trim();
      const parsed = parseSelection(raw, [1, 2, 3, 4]);
      if (parsed) {
        selection = parsed;
        break;
      }
      warn('Enter one or more numbers from 1–4, comma-separated. Each value used at most once.');
    }

    const providers = [];
    for (const choice of selection) {
      if (choice === 4) {
        step('Custom provider');
        info('OpenAI-compatible endpoint (Chat Completions API). Stored as a separate provider.');
        let id;
        while (true) {
          id = (await ask('  Provider id (lowercase, a–z 0–9 -, used as DB key): ')).trim();
          if (/^[a-z0-9][a-z0-9-]*$/.test(id) && id !== 'anthropic' && id !== 'openai' && id !== 'zai-coding') break;
          warn('Use lowercase letters, digits, and hyphens. Cannot reuse a built-in provider id.');
        }
        const displayName = (await ask(`  Display name ${dim(`[${id}]`)}: `)).trim() || id;
        let baseUrl;
        while (true) {
          baseUrl = (await ask('  Base URL (e.g. http://localhost:8080/v1): ')).trim();
          if (/^https?:\/\//.test(baseUrl)) break;
          warn('Must start with http:// or https://');
        }
        let defaultModel;
        while (true) {
          defaultModel = (await ask('  Default model name: ')).trim();
          if (defaultModel.length > 0) break;
          warn('Model name cannot be empty.');
        }
        let apiKey;
        while (true) {
          apiKey = (await ask(`  API key for ${displayName}: `)).trim();
          if (apiKey.length > 0) break;
          warn('API key cannot be empty.');
        }
        providers.push({ id, displayName, defaultModel, apiKey, baseUrl, isCustom: true });
      } else {
        const spec = CATALOG[choice];
        let apiKey;
        while (true) {
          apiKey = (await ask(`  API key for ${spec.displayName}: `)).trim();
          if (apiKey.length > 0) break;
          warn('API key cannot be empty.');
        }
        providers.push({ ...spec, apiKey, isCustom: false });
      }
    }

    let defaultProvider = providers[0];
    if (providers.length > 1) {
      step('Default provider');
      providers.forEach((p, i) => console.log(`  ${i + 1}) ${p.displayName} (${p.id})`));
      while (true) {
        const raw = (await ask(`  Choice [1-${providers.length}] (default: 1): `)).trim() || '1';
        const n = Number.parseInt(raw, 10);
        if (!Number.isNaN(n) && n >= 1 && n <= providers.length) {
          defaultProvider = providers[n - 1];
          break;
        }
        warn(`Enter a number between 1 and ${providers.length}.`);
      }
    }

    const defaultModel =
      (await ask(
        `  Default model for ${defaultProvider.displayName} ${dim(`[${defaultProvider.defaultModel}]`)}: `,
      )).trim() || defaultProvider.defaultModel;

    let adminEmail = 'admin@clawix.test';
    let adminPassword = '';
    let adminName = 'Administrator';
    if (deployMode === 'production') {
      step('Initial admin');
      adminEmail =
        (await ask(`  Email ${dim('[admin@your-domain.com]')}: `)).trim() ||
        'admin@your-domain.com';
      while (true) {
        adminPassword = (await ask('  Password (min 8 chars): ')).trim();
        if (adminPassword.length >= 8) break;
        warn('Password must be at least 8 characters.');
      }
      adminName = (await ask(`  Name ${dim('[Administrator]')}: `)).trim() || 'Administrator';
    }

    step('Optional channels');
    const enableTelegram =
      (await ask('  Enable Telegram bot? (y/N): ')).trim().toLowerCase() === 'y';
    let telegramBotToken = '';
    if (enableTelegram) {
      while (true) {
        telegramBotToken = (await ask('  Telegram Bot Token: ')).trim();
        if (telegramBotToken.length > 0) break;
        warn('Bot token cannot be empty.');
      }
    }

    step('Summary');
    info(`Mode:     ${bold(deployMode)}`);
    info(`Providers:`);
    for (const p of providers) {
      const tag = p.id === defaultProvider.id ? bold(' (default)') : '';
      info(`  - ${p.displayName} [${p.id}]${tag}`);
    }
    info(`Default:  ${bold(defaultProvider.displayName)} (${defaultModel})`);
    if (deployMode === 'production') info(`Admin:    ${bold(adminName)} <${adminEmail}>`);
    info(`Telegram: ${enableTelegram ? bold('enabled') : dim('disabled')}`);

    const go = (await ask('\n  Proceed? (Y/n): ')).trim().toLowerCase();
    if (go === 'n' || go === 'no') {
      console.log('\nCancelled.');
      rl.close();
      process.exit(0);
    }

    answers = {
      providers,
      defaultProvider,
      defaultModel,
      adminEmail,
      adminPassword,
      adminName,
      enableTelegram,
      telegramBotToken,
    };
  }

  rl.close();

  if (!envExists) {
    step('Writing .env');
    if (!existsSync(ENV_EXAMPLE)) {
      fail(`.env.example not found at ${ENV_EXAMPLE}`);
      process.exit(1);
    }
    let env = readFileSync(ENV_EXAMPLE, 'utf8');

    // --- Always set ---
    env = upsertEnvLine(env, 'DEFAULT_PROVIDER', answers.defaultProvider.id);
    env = upsertEnvLine(env, 'DEFAULT_LLM_MODEL', answers.defaultModel);
    for (const p of answers.providers) {
      if (p.isCustom) {
        env = upsertEnvLine(env, 'CUSTOM_PROVIDER_NAME', p.id);
        env = upsertEnvLine(env, 'CUSTOM_PROVIDER_DISPLAY_NAME', p.displayName);
        env = upsertEnvLine(env, 'CUSTOM_PROVIDER_BASE_URL', p.baseUrl);
        env = upsertEnvLine(env, 'CUSTOM_PROVIDER_DEFAULT_MODEL', p.defaultModel);
        env = upsertEnvLine(env, 'CUSTOM_PROVIDER_API_KEY', p.apiKey);
      } else {
        env = upsertEnvLine(env, p.envKey, p.apiKey);
      }
    }
    if (answers.enableTelegram) {
      env = upsertEnvLine(env, 'TELEGRAM_BOT_TOKEN', answers.telegramBotToken);
    }
    env = upsertEnvLine(env, 'CLAWIX_DEPLOY_MODE', deployMode);

    if (deployMode === 'production') {
      env = upsertEnvLine(env, 'NODE_ENV', 'production');
      env = upsertEnvLine(env, 'LOG_LEVEL', 'info');
      env = upsertEnvLine(env, 'JWT_SECRET', secret(48));
      env = upsertEnvLine(env, 'PROVIDER_ENCRYPTION_KEY', secret(32));
      env = upsertEnvLine(env, 'POSTGRES_PASSWORD', secret(16));
      env = upsertEnvLine(env, 'POSTGRES_USER', 'clawix');
      env = upsertEnvLine(env, 'POSTGRES_DB', 'clawix');
      env = upsertEnvLine(
        env,
        'CORS_ALLOWED_ORIGINS',
        process.env['CORS_ALLOWED_ORIGINS'] ?? 'http://localhost:3000',
      );
      env = upsertEnvLine(env, 'INITIAL_ADMIN_EMAIL', answers.adminEmail);
      env = upsertEnvLine(env, 'INITIAL_ADMIN_PASSWORD', answers.adminPassword);
      env = upsertEnvLine(env, 'INITIAL_ADMIN_NAME', answers.adminName);
    } else {
      // Dev uses the existing seed.ts which reads DEFAULT_PASSWORD.
      env = upsertEnvLine(env, 'DEFAULT_PASSWORD', 'password1234');
      if (!/^\s*PROVIDER_ENCRYPTION_KEY=/m.test(env) || /\$\(openssl/.test(env)) {
        env = upsertEnvLine(env, 'PROVIDER_ENCRYPTION_KEY', secret(32));
      }
    }

    writeFileSync(ENV_FILE, env, { mode: 0o600 });
    ok(`.env written (permissions 600)`);
  }

  step('Installing dependencies');
  runVisible('pnpm install');
  ok('pnpm install done');

  step('Building @clawix/shared');
  runVisible('pnpm --filter @clawix/shared run build');
  ok('Built');

  step('Building agent Docker image');
  runVisible('docker build -t clawix-agent:latest -f infra/docker/agent/Dockerfile .');
  ok('clawix-agent:latest built');

  step(`Starting stack (${deployMode})`);
  const upArgs =
    deployMode === 'production' ? 'up -d --build --remove-orphans' : 'up -d --remove-orphans';
  runVisible(`docker compose -f "${composeFile}" ${upArgs}`);
  ok('Containers started');

  step('Waiting for API /health');
  info('This may take up to 3 minutes on first run (installing deps, migrations, bootstrap).');
  const healthy = await waitForHealth('http://localhost:3001/health', 180);
  if (!healthy) {
    fail('API did not become healthy within 3 minutes.');
    info(`Check logs: docker compose -f "${composeFile}" logs api`);
    process.exit(1);
  }
  ok('API is healthy');

  console.log(`\n${bold(green('=== Installation complete ==='))}\n`);
  console.log(`  ${bold('API:')}           ${cyan('http://localhost:3001')}`);
  console.log(`  ${bold('Web dashboard:')} ${cyan('http://localhost:3000')}`);
  if (deployMode === 'production' && answers) {
    console.log(`\n  ${bold('Log in with:')}`);
    console.log(`    Email:    ${answers.adminEmail}`);
    console.log(`    Password: (the one you entered)`);
  } else if (deployMode === 'development') {
    console.log(`\n  ${bold('Log in with:')}`);
    console.log(`    Email:    admin@clawix.test`);
    console.log(`    Password: password1234`);
  }
  console.log(`\n  ${bold('Next:')}`);
  console.log(`    ${dim('node scripts/update.mjs')}  rebuild & restart after code changes`);
  console.log(`    ${dim(`docker compose -f ${composeFile.replace(ROOT + '/', '')} logs -f`)}  tail logs`);
  console.log('');
}

main().catch((err) => {
  fail('Installation failed:');
  console.error(err);
  process.exit(1);
});
