#!/usr/bin/env node

/**
 * Clawix Uninstaller
 *
 * Removes Docker containers, images, volumes for both dev and prod environments.
 * Optionally removes host-mounted data (./data, .env, ./skills/custom).
 *
 * Usage:
 *   node scripts/uninstall.mjs          # Docker cleanup only
 *   node scripts/uninstall.mjs --full   # Docker + host data
 */

import { execSync } from 'node:child_process';
import { existsSync, rmSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const COMPOSE_PROD = join(ROOT, 'docker-compose.prod.yml');
const COMPOSE_DEV = join(ROOT, 'docker-compose.dev.yml');
const ENV_FILE = join(ROOT, '.env');
const DATA_DIR = join(ROOT, 'data');
const CUSTOM_SKILLS_DIR = join(ROOT, 'skills', 'custom');

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
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
}

function runSilent(cmd) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runVisible(cmd) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove path, prompting for sudo if permission denied.
 * Returns: 'removed' | 'not_found' | 'cancelled' | 'failed'
 */
async function rmWithSudo(path, rl) {
  if (!existsSync(path)) return 'not_found';

  try {
    rmSync(path, { recursive: true, force: true });
    return 'removed';
  } catch (err) {
    if (err.code !== 'EACCES' && err.code !== 'EPERM') throw err;

    warn(`Permission denied: ${path}`);
    info(dim('Directory likely created by Docker (root-owned)'));

    const answer = (await rl.question('  Use sudo to remove? (y/N): ')).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') return 'cancelled';

    try {
      execSync(`sudo rm -rf "${path}"`, { cwd: ROOT, stdio: 'inherit' });
      return 'removed';
    } catch {
      return 'failed';
    }
  }
}

process.on('SIGINT', () => {
  console.log('\n\nUninstall cancelled.');
  process.exit(130);
});

async function main() {
  const args = process.argv.slice(2);
  const fullMode = args.includes('--full') || args.includes('-f');
  const skipConfirm = args.includes('--yes') || args.includes('-y');

  console.log(`\n${bold('=== Clawix Uninstaller ===')}\n`);

  if (fullMode) {
    warn('Full mode: will remove Docker resources AND host data (.env, ./data, ./skills/custom)');
  } else {
    info('Docker mode: will remove containers, images, and volumes only');
    info(dim('Use --full to also remove host data'));
  }

  if (!skipConfirm) {
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = (await rl.question('\n  Continue? (y/N): ')).trim().toLowerCase();
    rl.close();
    if (answer !== 'y' && answer !== 'yes') {
      console.log('\nCancelled.');
      process.exit(0);
    }
  }

  step('Stopping development environment');
  if (existsSync(COMPOSE_DEV)) {
    if (
      runVisible(`docker compose -f "${COMPOSE_DEV}" down --rmi all --volumes --remove-orphans`)
    ) {
      ok('Dev containers removed');
    } else {
      warn('Dev environment not running or already removed');
    }
  } else {
    info(dim('docker-compose.dev.yml not found, skipping'));
  }

  step('Stopping production environment');
  if (existsSync(COMPOSE_PROD)) {
    if (
      runVisible(`docker compose -f "${COMPOSE_PROD}" down --rmi all --volumes --remove-orphans`)
    ) {
      ok('Prod containers removed');
    } else {
      warn('Prod environment not running or already removed');
    }
  } else {
    info(dim('docker-compose.prod.yml not found, skipping'));
  }

  step('Stopping runtime agent containers');
  try {
    // Find all containers using clawix-agent image (warm pool + active agents)
    const containers = run('docker ps -aq --filter "ancestor=clawix-agent:latest"');
    if (containers) {
      const ids = containers.split('\n').filter(Boolean);
      if (ids.length > 0) {
        runSilent(`docker stop ${ids.join(' ')}`);
        runSilent(`docker rm -f ${ids.join(' ')}`);
        ok(`${ids.length} agent container(s) removed`);
      }
    } else {
      info(dim('No runtime agent containers found'));
    }
  } catch {
    info(dim('No runtime agent containers found'));
  }

  step('Removing agent image');
  if (runSilent('docker rmi clawix-agent:latest')) {
    ok('clawix-agent:latest removed');
  } else {
    info(dim('Image not found or already removed'));
  }

  step('Removing python-runner image');
  if (runSilent('docker rmi clawix-python-runner:latest')) {
    ok('clawix-python-runner:latest removed');
  } else {
    info(dim('Image not found or already removed'));
  }

  step('Pruning dangling images');
  try {
    const pruned = run('docker image prune -f --filter "label=com.clawix=true"');
    if (pruned.includes('Total reclaimed space')) {
      ok('Dangling Clawix images pruned');
    } else {
      info(dim('No dangling images to prune'));
    }
  } catch {
    info(dim('No dangling images to prune'));
  }

  if (fullMode) {
    step('Removing host data');

    // Create readline for sudo prompts
    const rl = createInterface({ input: stdin, output: stdout });

    if (existsSync(ENV_FILE)) {
      rmSync(ENV_FILE);
      ok('.env removed');
    } else {
      info(dim('.env not found'));
    }

    const dataResult = await rmWithSudo(DATA_DIR, rl);
    switch (dataResult) {
      case 'removed':
        ok('./data/ removed');
        break;
      case 'not_found':
        info(dim('./data/ not found'));
        break;
      case 'cancelled':
        warn('./data/ skipped (user cancelled)');
        break;
      case 'failed':
        fail('./data/ removal failed');
        break;
    }

    if (existsSync(CUSTOM_SKILLS_DIR)) {
      const entries = readdirSync(CUSTOM_SKILLS_DIR);
      if (entries.length > 0) {
        let allRemoved = true;
        for (const entry of entries) {
          const entryPath = join(CUSTOM_SKILLS_DIR, entry);
          const result = await rmWithSudo(entryPath, rl);
          if (result === 'failed' || result === 'cancelled') allRemoved = false;
        }
        if (allRemoved) {
          ok('./skills/custom/ contents removed');
        } else {
          warn('./skills/custom/ partially removed');
        }
      } else {
        info(dim('./skills/custom/ already empty'));
      }
    } else {
      info(dim('./skills/custom/ not found'));
    }

    rl.close();
  }

  console.log(`\n${bold(green('=== Uninstall complete ==='))}\n`);

  if (!fullMode) {
    info('Host data preserved:');
    if (existsSync(ENV_FILE)) info(`  ${dim('.env')} (configuration)`);
    if (existsSync(DATA_DIR)) info(`  ${dim('./data/')} (runtime data)`);
    if (existsSync(CUSTOM_SKILLS_DIR)) info(`  ${dim('./skills/custom/')} (user skills)`);
    console.log('');
    info(`Run ${cyan('node scripts/uninstall.mjs --full')} to remove these too.`);
  } else {
    info('All Clawix data removed. Ready for fresh install.');
  }

  console.log('');
}

main().catch((err) => {
  fail('Uninstall failed:');
  console.error(err);
  process.exit(1);
});
