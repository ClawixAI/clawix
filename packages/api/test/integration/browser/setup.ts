/**
 * Integration test setup/teardown for the browser sidecar (clawix-browser).
 *
 * Usage: call setupBrowserIntegration() in a beforeAll hook and
 * teardownBrowserIntegration() in a corresponding afterAll hook.
 *
 * The test suite is gated by the INTEGRATION=true environment variable.
 * Without it the tests are skipped entirely — no Docker is required.
 *
 * Run with:
 *   INTEGRATION=true BROWSER_AUTH_TOKEN=test-token pnpm vitest run test/integration/browser/
 */
import { execSync } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Path to the repo root (three levels up from packages/api/test/integration/browser). */
function repoRoot(): string {
  return resolve(__dirname, '..', '..', '..', '..', '..');
}

const COMPOSE_FILE = 'docker-compose.dev.yml';
const SIDECAR_HEALTH_URL =
  process.env['BROWSER_SIDECAR_HEALTH_URL'] ?? 'http://localhost:3001/health';

/**
 * Bring up the clawix-browser sidecar via Docker Compose and wait for it to
 * become healthy (up to 30 seconds).
 */
export async function setupBrowserIntegration(): Promise<void> {
  execSync(`docker compose -f ${COMPOSE_FILE} up -d clawix-browser`, {
    stdio: 'inherit',
    cwd: repoRoot(),
  });

  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(SIDECAR_HEALTH_URL);
      if (res.ok) return;
    } catch {
      // not ready yet — keep polling
    }
    await wait(1_000);
  }

  throw new Error('clawix-browser sidecar did not become healthy within 30 s');
}

/**
 * Stop (but do not remove) the clawix-browser sidecar after the test run.
 * Volumes and networks are left in place to speed up subsequent runs.
 */
export function teardownBrowserIntegration(): void {
  execSync(`docker compose -f ${COMPOSE_FILE} stop clawix-browser`, {
    stdio: 'inherit',
    cwd: repoRoot(),
  });
}
