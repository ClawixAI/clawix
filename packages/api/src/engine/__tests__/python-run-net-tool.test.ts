import { describe, it, expect, vi } from 'vitest';
import { createPythonRunNetTool, PythonRunNetDeps } from '../tools/python/python-run-net.js';
import type { PythonToolPolicy } from '../tools/python/types.js';

const policy: PythonToolPolicy = {
  allowPython: true,
  allowPythonNet: true,
  pythonPackageAllowlist: ['httpx'],
  maxPythonMemoryMb: 2048,
  maxPythonTimeoutSecs: 300,
  maxPythonCpuCores: 2,
  maxConcurrentPythonRuns: 3,
};

function makeDeps(overrides: Partial<PythonRunNetDeps> = {}): PythonRunNetDeps {
  return {
    userId: 'u1',
    workspaceHostPath: '/tmp/ws-s1',
    policy,
    runner: {
      start: vi.fn(async () => 'c-eph-1'),
      exec: vi.fn(async () => ({ exitCode: 0, stdout: 'ok', stderr: '' })),
      stop: vi.fn(async () => undefined),
    },
    proxyHealth: { isHealthy: () => true },
    limiter: { acquire: vi.fn(), release: vi.fn() },
    installMutex: { runExclusive: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()) },
    ...overrides,
  } as unknown as PythonRunNetDeps;
}

describe('python_run_net tool', () => {
  it('starts an ephemeral container and stops it after exec', async () => {
    const deps = makeDeps();
    const tool = createPythonRunNetTool(deps);
    await tool.execute({ code: 'print(1)' }, { abortSignal: new AbortController().signal });
    expect(deps.runner.start).toHaveBeenCalledOnce();
    expect(deps.runner.stop).toHaveBeenCalledWith('c-eph-1');
  });

  it('stops the container even when exec fails', async () => {
    const deps = makeDeps({
      runner: {
        start: vi.fn(async () => 'c-eph-2'),
        exec: vi.fn(async () => {
          throw new Error('boom');
        }),
        stop: vi.fn(async () => undefined),
      },
    });
    const tool = createPythonRunNetTool(deps);
    await tool.execute({ code: 'print(1)' }, { abortSignal: new AbortController().signal });
    expect(deps.runner.stop).toHaveBeenCalledWith('c-eph-2');
  });

  it('passes constrained network to runner.start', async () => {
    const deps = makeDeps();
    const tool = createPythonRunNetTool(deps);
    await tool.execute({ code: 'print(1)' }, { abortSignal: new AbortController().signal });
    const startArgs = (deps.runner.start as ReturnType<typeof vi.fn>).mock.calls[0];
    // start(agentDef, mounts, options) — third arg must include network: 'clawix-python-net-egress'
    expect(startArgs[2]).toMatchObject({ network: 'clawix-python-net-egress' });
  });

  it('passes timeout to runner.exec in milliseconds', async () => {
    const execMock = vi.fn(
      async (_id: string, _cmd: readonly string[], opts?: { timeout?: number }) => {
        return { exitCode: 0, stdout: 'ok', stderr: '', _seenTimeout: opts?.timeout };
      },
    );
    const deps = makeDeps({
      runner: {
        start: vi.fn(async () => 'c-eph-timeout'),
        exec: execMock,
        stop: vi.fn(async () => undefined),
      },
    });
    const tool = createPythonRunNetTool(deps);
    await tool.execute(
      { code: 'x', timeoutSecs: 30 },
      { abortSignal: new AbortController().signal },
    );
    // Check that one of the exec calls (the python one) used 30000 ms timeout
    const seen = execMock.mock.calls
      .map((c) => (c[2] as { timeout?: number } | undefined)?.timeout)
      .filter((t) => t !== undefined);
    expect(seen).toContain(30_000);
  });

  it('returns SCRIPT_NOT_FOUND when script does not exist', async () => {
    const execMock = vi.fn(async (_id: string, cmd: readonly string[]) => {
      if (cmd[0] === 'touch') return { exitCode: 0, stdout: '', stderr: '' };
      // Simulate the realpath/existence check returning NOTFOUND
      if (cmd[0] === 'sh') return { exitCode: 0, stdout: 'NOTFOUND\n', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const deps = makeDeps({
      runner: {
        start: vi.fn(async () => 'c-eph-notfound'),
        exec: execMock,
        stop: vi.fn(async () => undefined),
      },
    });
    const tool = createPythonRunNetTool(deps);
    const res = await tool.execute(
      { script: '/workspace/nonexistent.py' },
      { abortSignal: new AbortController().signal },
    );
    expect(res.isError).toBe(true);
    expect(res.output).toMatch(/script not found|escapes \/workspace/);
  });

  it('returns SCRIPT_NOT_FOUND when script resolves outside /workspace', async () => {
    const execMock = vi.fn(async (_id: string, cmd: readonly string[]) => {
      if (cmd[0] === 'touch') return { exitCode: 0, stdout: '', stderr: '' };
      // Simulate symlink pointing outside /workspace
      if (cmd[0] === 'sh') return { exitCode: 0, stdout: '/etc/passwd\n', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const deps = makeDeps({
      runner: {
        start: vi.fn(async () => 'c-eph-escape'),
        exec: execMock,
        stop: vi.fn(async () => undefined),
      },
    });
    const tool = createPythonRunNetTool(deps);
    const res = await tool.execute(
      { script: '/workspace/evil.py' },
      { abortSignal: new AbortController().signal },
    );
    expect(res.isError).toBe(true);
    expect(res.output).toMatch(/script not found|escapes \/workspace/);
  });

  it('executes script successfully when realpath is inside /workspace', async () => {
    const execMock = vi.fn(async (_id: string, cmd: readonly string[]) => {
      if (cmd[0] === 'touch') return { exitCode: 0, stdout: '', stderr: '' };
      if (cmd[0] === 'sh') return { exitCode: 0, stdout: '/workspace/run.py\n', stderr: '' };
      if (cmd[0] === 'find') return { exitCode: 0, stdout: '', stderr: '' };
      return { exitCode: 0, stdout: 'result', stderr: '' };
    });
    const deps = makeDeps({
      runner: {
        start: vi.fn(async () => 'c-eph-ok'),
        exec: execMock,
        stop: vi.fn(async () => undefined),
      },
    });
    const tool = createPythonRunNetTool(deps);
    const res = await tool.execute(
      { script: '/workspace/run.py' },
      { abortSignal: new AbortController().signal },
    );
    expect(res.isError).toBe(false);
    expect((res as unknown as { stdout: string }).stdout).toBe('result');
  });
});
