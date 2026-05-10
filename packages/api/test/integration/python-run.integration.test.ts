/**
 * Integration test — python_run end-to-end with real Docker containers.
 *
 * Gate: only runs when INTEGRATION=1 is set in the environment.
 *
 * Requires:
 *   - Docker daemon accessible
 *   - clawix-python-runner:latest image built
 *     (docker build -t clawix-python-runner:latest infra/docker/python-runner)
 *   - Docker networks created (e.g. via docker compose -f docker-compose.dev.yml up)
 *
 * To run:
 *   INTEGRATION=1 pnpm --filter @clawix/api exec vitest run test/integration/python-run.integration.test.ts
 *
 * The test instantiates ContainerRunner and PythonContainerPoolService directly
 * (no NestJS bootstrap) to avoid pulling in the full DB/Prisma stack.
 * The Docker network name is taken from PYTHON_POOL_NETWORK_NAME env var
 * (default: clawix_clawix-internal, matching the docker-compose.dev.yml naming).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PythonContainerPoolService } from '../../src/engine/python-container-pool.service.js';
import { ContainerRunner } from '../../src/engine/container-runner.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const isOptIn = process.env['INTEGRATION'] === '1';
const describeIntegration = isOptIn ? describe : describe.skip;

// Docker Compose prefixes network names with the project name (clawix_).
// Override with PYTHON_POOL_NETWORK_NAME if your setup differs.
const NETWORK_NAME =
  process.env['PYTHON_POOL_NETWORK_NAME'] ??
  process.env['PYTHON_PROXY_NETWORK_NAME'] ??
  'clawix_clawix-internal';

describeIntegration('python_run end-to-end', () => {
  let pool: PythonContainerPoolService;
  let runner: ContainerRunner;
  let workspace: string;

  beforeAll(async () => {
    runner = new ContainerRunner();
    pool = new PythonContainerPoolService(runner, { proxyNetworkName: NETWORK_NAME });
    workspace = mkdtempSync(join(tmpdir(), 'clawix-py-it-'));
  }, 60_000);

  afterAll(async () => {
    await pool.drainAll();
    rmSync(workspace, { recursive: true, force: true });
  }, 30_000);

  it('runs pre-baked pandas successfully', async () => {
    writeFileSync(join(workspace, 'data.csv'), 'a,b\n1,2\n3,4\n');
    const containerId = await pool.acquire('test-session', { workspaceHostPath: workspace });
    const res = await runner.exec(containerId, [
      'python',
      '-c',
      "import pandas as pd; print(pd.read_csv('/workspace/data.csv').sum().to_string())",
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toMatch(/a\s+4/);
  }, 90_000);

  it('warm-pool reuse: second acquire returns same container', async () => {
    const id1 = await pool.acquire('test-session-2', { workspaceHostPath: workspace });
    pool.release('test-session-2');
    const id2 = await pool.acquire('test-session-2', { workspaceHostPath: workspace });
    expect(id2).toBe(id1);
  }, 60_000);
});
