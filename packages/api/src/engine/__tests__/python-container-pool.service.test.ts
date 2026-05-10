/**
 * Tests for PythonContainerPoolService.
 *
 * Mocks IContainerRunner to isolate pool logic from Docker.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ------------------------------------------------------------------ //
//  Module mocks — must be hoisted before imports                      //
// ------------------------------------------------------------------ //

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

vi.mock('../container-runner.js', () => ({
  ContainerRunner: class ContainerRunner {},
}));

// ------------------------------------------------------------------ //
//  Imports after mocks                                                //
// ------------------------------------------------------------------ //

import { PythonContainerPoolService } from '../python-container-pool.service.js';
import type { IContainerRunner } from '../container-runner.js';

// ------------------------------------------------------------------ //
//  Helpers                                                            //
// ------------------------------------------------------------------ //

function makeFakeRunner(): IContainerRunner {
  let nextId = 1;
  const runner = {
    start: vi.fn(async () => `pyc-${nextId++}`),
    exec: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    stop: vi.fn(async () => undefined),
  };
  return runner as unknown as IContainerRunner;
}

// ------------------------------------------------------------------ //
//  Tests                                                              //
// ------------------------------------------------------------------ //

describe('PythonContainerPoolService', () => {
  let runner: IContainerRunner;
  let pool: PythonContainerPoolService;

  beforeEach(() => {
    runner = makeFakeRunner();
    pool = new PythonContainerPoolService(runner, {
      idleTimeoutSec: 60,
      maxLifetimeSec: 3600,
      maxPoolSize: 5,
    });
  });

  it('starts a new container on first acquire for a session', async () => {
    const id = await pool.acquire('s1', { workspaceHostPath: '/tmp/ws-s1' });
    expect(id).toBe('pyc-1');
    expect(runner.start).toHaveBeenCalledOnce();
  });

  it('reuses the same container on second acquire in same session', async () => {
    const id1 = await pool.acquire('s1', { workspaceHostPath: '/tmp/ws-s1' });
    pool.release('s1');
    const id2 = await pool.acquire('s1', { workspaceHostPath: '/tmp/ws-s1' });
    expect(id2).toBe(id1);
    expect(runner.start).toHaveBeenCalledOnce();
  });

  it('runs a healthcheck (docker exec true) on warm hit', async () => {
    await pool.acquire('s1', { workspaceHostPath: '/tmp/ws-s1' });
    pool.release('s1');
    await pool.acquire('s1', { workspaceHostPath: '/tmp/ws-s1' });
    expect(runner.exec).toHaveBeenCalledWith('pyc-1', ['true'], expect.any(Object));
  });

  it('evicts and creates a new container when healthcheck fails', async () => {
    await pool.acquire('s1', { workspaceHostPath: '/tmp/ws-s1' });
    pool.release('s1');
    (runner.exec as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'dead',
    });
    const id2 = await pool.acquire('s1', { workspaceHostPath: '/tmp/ws-s1' });
    expect(id2).toBe('pyc-2');
    expect(runner.stop).toHaveBeenCalledWith('pyc-1');
  });

  it('drainAll() stops every active container', async () => {
    await pool.acquire('s1', { workspaceHostPath: '/tmp/ws-s1' });
    await pool.acquire('s2', { workspaceHostPath: '/tmp/ws-s2' });
    await pool.drainAll();
    expect(runner.stop).toHaveBeenCalledWith('pyc-1');
    expect(runner.stop).toHaveBeenCalledWith('pyc-2');
  });

  it('passes memoryMb and cpus to runner.start when provided', async () => {
    await pool.acquire('s1', { workspaceHostPath: '/tmp/ws-s1', memoryMb: 4096, cpus: 4 });
    const startArgs = (runner.start as ReturnType<typeof vi.fn>).mock.calls[0] as
      | [{ containerConfig: { memoryLimit: string; cpuLimit: string } }, unknown, unknown]
      | undefined;
    // start(agentDef, mounts, options) — agent def's containerConfig has the limits
    const agentDef = startArgs?.[0];
    expect(agentDef?.containerConfig.memoryLimit).toBe('4096m');
    expect(agentDef?.containerConfig.cpuLimit).toBe('4');
  });

  it('passes proxyNetworkName to runner.start', async () => {
    const customRunner = makeFakeRunner();
    const customPool = new PythonContainerPoolService(customRunner, {
      idleTimeoutSec: 60,
      maxLifetimeSec: 3600,
      maxPoolSize: 5,
      proxyNetworkName: 'custom-net',
    });
    await customPool.acquire('s1', { workspaceHostPath: '/tmp/ws-s1' });
    const startCallArgs = (customRunner.start as ReturnType<typeof vi.fn>).mock.calls[0] as
      | [unknown, unknown, unknown]
      | undefined;
    // start(agentDef, mounts, options) — options is the third arg
    expect(startCallArgs?.[2]).toMatchObject({ network: 'custom-net' });
  });
});
