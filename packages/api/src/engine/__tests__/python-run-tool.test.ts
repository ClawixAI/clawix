import { describe, it, expect, vi } from 'vitest';
import { createPythonRunTool, PythonRunDeps } from '../tools/python/python-run.js';
import type { PythonToolPolicy } from '../tools/python/types.js';

const basePolicy: PythonToolPolicy = {
  allowPython: true,
  allowPythonNet: false,
  pythonPackageAllowlist: ['polars'],
  maxPythonMemoryMb: 512,
  maxPythonTimeoutSecs: 60,
  maxPythonCpuCores: 1,
  maxConcurrentPythonRuns: 2,
};

function makeDeps(overrides: Partial<PythonRunDeps> = {}): PythonRunDeps {
  return {
    sessionId: 's1',
    userId: 'u1',
    workspaceHostPath: '/tmp/ws-s1',
    policy: basePolicy,
    pool: {
      acquire: vi.fn(async () => 'c1'),
      release: vi.fn(),
    },
    runner: {
      exec: vi.fn(async () => ({ exitCode: 0, stdout: 'ok', stderr: '' })),
    },
    proxyHealth: { isHealthy: () => true },
    limiter: { acquire: vi.fn(), release: vi.fn() },
    installMutex: { runExclusive: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()) },
    ...overrides,
  } as unknown as PythonRunDeps;
}

describe('python_run tool', () => {
  it('runs code with no packages and returns stdout', async () => {
    const deps = makeDeps();
    const tool = createPythonRunTool(deps);
    const res = await tool.execute(
      { code: 'print(1)' },
      { abortSignal: new AbortController().signal },
    );
    expect(res.isError).toBe(false);
    expect((res as unknown as { stdout: string }).stdout).toBe('ok');
  });

  it('returns INVALID_INPUT when both code and script are provided', async () => {
    const deps = makeDeps();
    const tool = createPythonRunTool(deps);
    const res = await tool.execute(
      { code: 'x', script: '/workspace/y.py' },
      { abortSignal: new AbortController().signal },
    );
    expect(res.isError).toBe(true);
    expect(res.output).toMatch(/exactly one of/);
  });

  it('returns PACKAGE_NOT_ALLOWED for non-allowlisted packages', async () => {
    const deps = makeDeps();
    const tool = createPythonRunTool(deps);
    const res = await tool.execute(
      { code: 'x', packages: ['yfinance'] },
      { abortSignal: new AbortController().signal },
    );
    expect(res.isError).toBe(true);
    expect(res.output).toMatch(/yfinance/);
  });

  it('returns PROXY_UNAVAILABLE when proxy is down and packages requested', async () => {
    const deps = makeDeps({ proxyHealth: { isHealthy: () => false } });
    const tool = createPythonRunTool(deps);
    const res = await tool.execute(
      { code: 'x', packages: ['polars'] },
      { abortSignal: new AbortController().signal },
    );
    expect(res.isError).toBe(true);
    expect(res.output).toMatch(/proxy unavailable/i);
  });

  it('runs pip install before executing code when packages requested and proxy healthy', async () => {
    const execMock = vi.fn(async (_id: string, cmd: readonly string[]) => {
      if (cmd[0] === 'pip') return { exitCode: 0, stdout: 'installed', stderr: '' };
      if (cmd[0] === 'touch') return { exitCode: 0, stdout: '', stderr: '' };
      if (cmd[0] === 'find') return { exitCode: 0, stdout: 'out.csv\n', stderr: '' };
      return { exitCode: 0, stdout: 'done', stderr: '' };
    });
    const deps = makeDeps({ runner: { exec: execMock } });
    const tool = createPythonRunTool(deps);
    const res = await tool.execute(
      { code: 'x', packages: ['polars'] },
      { abortSignal: new AbortController().signal },
    );
    expect(res.isError).toBe(false);
    expect((res as unknown as { filesChanged: string[] }).filesChanged).toEqual(['out.csv']);
    const cmds = execMock.mock.calls.map((c) => c[1][0]);
    expect(cmds).toContain('pip');
    expect(cmds).toContain('python');
  });

  it('returns CONCURRENCY_LIMIT when limiter rejects', async () => {
    const limiter = {
      acquire: vi.fn(() => {
        const e = new Error(
          'Error: max concurrent python runs (2) reached. Wait for an in-flight run to finish.',
        );
        (e as unknown as { code: string }).code = 'CONCURRENCY_LIMIT';
        throw e;
      }),
      release: vi.fn(),
    };
    const deps = makeDeps({ limiter });
    const tool = createPythonRunTool(deps);
    const res = await tool.execute({ code: 'x' }, { abortSignal: new AbortController().signal });
    expect(res.isError).toBe(true);
    expect(res.output).toMatch(/max concurrent/);
  });

  it('includes filesChanged summary in output', async () => {
    const execMock = vi.fn(async (_id: string, cmd: readonly string[]) => {
      if (cmd[0] === 'find') return { exitCode: 0, stdout: 'out.csv\nplot.png\n', stderr: '' };
      if (cmd[0] === 'touch') return { exitCode: 0, stdout: '', stderr: '' };
      return { exitCode: 0, stdout: 'done', stderr: '' };
    });
    const deps = makeDeps({ runner: { exec: execMock } });
    const tool = createPythonRunTool(deps);
    const res = await tool.execute({ code: 'x' }, { abortSignal: new AbortController().signal });
    expect(res.output).toMatch(/Files written to \/workspace: out\.csv, plot\.png/);
  });

  it('always releases the limiter even on failure', async () => {
    const release = vi.fn();
    const deps = makeDeps({
      limiter: { acquire: vi.fn(), release },
      runner: {
        exec: vi.fn(async () => {
          throw new Error('boom');
        }),
      },
    });
    const tool = createPythonRunTool(deps);
    await tool.execute({ code: 'x' }, { abortSignal: new AbortController().signal });
    expect(release).toHaveBeenCalledOnce();
  });

  it('passes timeout to runner.exec in milliseconds', async () => {
    const execMock = vi.fn(
      async (_id: string, _cmd: readonly string[], opts?: { timeout?: number }) => {
        return { exitCode: 0, stdout: 'ok', stderr: '', _seenTimeout: opts?.timeout };
      },
    );
    const deps = makeDeps({ runner: { exec: execMock } });
    const tool = createPythonRunTool(deps);
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
    const deps = makeDeps({ runner: { exec: execMock } });
    const tool = createPythonRunTool(deps);
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
    const deps = makeDeps({ runner: { exec: execMock } });
    const tool = createPythonRunTool(deps);
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
    const deps = makeDeps({ runner: { exec: execMock } });
    const tool = createPythonRunTool(deps);
    const res = await tool.execute(
      { script: '/workspace/run.py' },
      { abortSignal: new AbortController().signal },
    );
    expect(res.isError).toBe(false);
    expect((res as unknown as { stdout: string }).stdout).toBe('result');
  });
});
