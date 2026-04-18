#!/usr/bin/env node

/**
 * Clawix Updater (non-interactive)
 *
 * Rebuilds images and restarts the stack. Deploy mode is read from `.env`
 * (`CLAWIX_DEPLOY_MODE`) so this script matches whatever install.mjs set up.
 *
 * Flags:
 *   --pull          git pull before rebuild
 *   --no-build      skip --build on `docker compose up` (plain restart)
 *   --mode=prod|dev override CLAWIX_DEPLOY_MODE
 *
 * Usage:
 *   node scripts/update.mjs           # rebuild + restart (default)
 *   node scripts/update.mjs --pull    # git pull first
 *   node scripts/update.mjs --no-build
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENV_FILE = join(ROOT, '.env');
const COMPOSE_PROD = join(ROOT, 'docker-compose.prod.yml');
const COMPOSE_DEV = join(ROOT, 'docker-compose.dev.yml');

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

const ok = (m) => console.log(`  ${green('✓')} ${m}`);
const warn = (m) => console.log(`  ${yellow('⚠')} ${m}`);
const fail = (m) => console.error(`  ${red('✗')} ${m}`);
const step = (m) => console.log(`\n${bold(cyan(`--- ${m} ---`))}`);

function runVisible(cmd) {
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

function parseArgs(argv) {
  const flags = { pull: false, build: true, mode: null };
  for (const a of argv) {
    if (a === '--pull') flags.pull = true;
    else if (a === '--no-build') flags.build = false;
    else if (a.startsWith('--mode=')) flags.mode = a.slice('--mode='.length);
    else if (a === '-h' || a === '--help') {
      console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 18).join('\n'));
      process.exit(0);
    }
  }
  return flags;
}

function readDeployMode() {
  if (!existsSync(ENV_FILE)) return null;
  const env = readFileSync(ENV_FILE, 'utf8');
  const match = env.match(/^\s*CLAWIX_DEPLOY_MODE=(.+)$/m);
  return match ? match[1].trim() : null;
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

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (!existsSync(ENV_FILE)) {
    fail('.env not found. Run `node scripts/install.mjs` first.');
    process.exit(1);
  }

  let deployMode = flags.mode ?? readDeployMode();
  if (deployMode === 'prod') deployMode = 'production';
  if (deployMode === 'dev') deployMode = 'development';
  if (deployMode !== 'production' && deployMode !== 'development') {
    warn(`CLAWIX_DEPLOY_MODE not set in .env — defaulting to production.`);
    deployMode = 'production';
  }
  const composeFile = deployMode === 'production' ? COMPOSE_PROD : COMPOSE_DEV;

  console.log(`\n${bold('=== Clawix Updater ===')} (${deployMode})\n`);

  if (flags.pull) {
    step('git pull');
    runVisible('git pull --ff-only');
    ok('Pulled');
  }

  step('Restarting stack');
  const buildFlag = flags.build ? '--build' : '';
  runVisible(
    `docker compose -f "${composeFile}" up -d --remove-orphans ${buildFlag}`.trim(),
  );
  ok('Containers up');

  step('Waiting for API /health');
  const healthy = await waitForHealth('http://localhost:3001/health', 180);
  if (!healthy) {
    fail('API did not become healthy within 3 minutes.');
    console.log(`  Check logs: docker compose -f "${composeFile}" logs api`);
    process.exit(1);
  }
  ok('API is healthy');

  console.log(`\n${bold(green('=== Update complete ==='))}\n`);
  console.log(`  ${bold('API:')}           ${cyan('http://localhost:3001')}`);
  console.log(`  ${bold('Web dashboard:')} ${cyan('http://localhost:3000')}`);
  console.log('');
}

main().catch((err) => {
  fail('Update failed:');
  console.error(err);
  process.exit(1);
});
