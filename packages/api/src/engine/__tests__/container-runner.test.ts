/**
 * Tests for ContainerRunner.
 *
 * Mocks child_process (execFile + spawn) and mount-security to isolate
 * all Docker CLI interactions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentDefinition } from '@clawix/shared';

// ------------------------------------------------------------------ //
//  Module mocks (must be hoisted before dynamic imports)             //
// ------------------------------------------------------------------ //

// We need to mock execFile at the promisified level since ContainerRunner
// does `const execFileAsync = promisify(execFileCb)` at module load time.
// Mocking child_process directly doesn't intercept promisify's wrapper.

const mockExecFileAsync =
  vi.fn<(...args: unknown[]) => Promise<{ stdout: string; stderr: string }>>();
const mockSpawn = vi.fn();

vi.mock('child_process', () => ({
  execFile: vi.fn(),
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('util')>();
  return {
    ...actual,
    promisify: () => mockExecFileAsync,
  };
});

vi.mock('../mount-security.js', () => ({
  validateMounts: vi.fn().mockReturnValue([]),
  loadAllowlist: vi.fn().mockReturnValue({
    allowedRoots: [],
    blockedPatterns: [],
  }),
}));

// Dynamic import after mocks are in place
const { ContainerRunner, buildDockerRunArgs, buildDockerExecArgs, MAX_STDIO_BUFFER_BYTES } =
  await import('../container-runner.js');

// ------------------------------------------------------------------ //
//  Helpers                                                            //
// ------------------------------------------------------------------ //

/** Factory for a minimal valid AgentDefinition. */
function makeAgentDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'agent-123',
    name: 'Test Agent',
    description: null,
    systemPrompt: 'You are a test agent.',
    role: 'primary',
    provider: 'anthropic',
    model: 'claude-3-haiku-20240307',
    apiBaseUrl: null,
    skillIds: [],
    maxTokensPerRun: 4096,
    containerConfig: {
      image: 'clawix-agent:latest',
      cpuLimit: '0.5',
      memoryLimit: '512m',
      timeoutSeconds: 30,
      readOnlyRootfs: true,
      allowedMounts: [],
    },
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

// ------------------------------------------------------------------ //
//  Setup / teardown                                                   //
// ------------------------------------------------------------------ //

beforeEach(() => {
  vi.clearAllMocks();
  // Default: docker run returns a container ID
  mockExecFileAsync.mockResolvedValue({ stdout: 'abc123\n', stderr: '' });
});

afterEach(() => {
  vi.useRealTimers();
});

// ------------------------------------------------------------------ //
//  start()                                                            //
// ------------------------------------------------------------------ //

describe('ContainerRunner.start()', () => {
  it('spawns a docker container and returns the trimmed container ID', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: 'abc123def456\n', stderr: '' });

    const runner = new ContainerRunner();
    const result = await runner.start(makeAgentDef());

    expect(result).toBe('abc123def456');

    // First call should be docker run
    const [cmd, args] = mockExecFileAsync.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('docker');
    expect(args[0]).toBe('run');
    expect(args[1]).toBe('-d');
  });

  it('includes security hardening flags --pids-limit and --security-opt no-new-privileges', async () => {
    const runner = new ContainerRunner();
    await runner.start(makeAgentDef());

    const [, args] = mockExecFileAsync.mock.calls[0] as [string, string[]];

    expect(args).toContain('--pids-limit');
    expect(args).toContain('256');
    expect(args).toContain('--security-opt');
    expect(args).toContain('no-new-privileges');
  });

  it('adds --read-only and --tmpfs when readOnlyRootfs is true', async () => {
    const runner = new ContainerRunner();
    await runner.start(makeAgentDef());

    const [, args] = mockExecFileAsync.mock.calls[0] as [string, string[]];

    expect(args).toContain('--read-only');
    expect(args).toContain('--tmpfs');
  });

  it('omits --read-only when readOnlyRootfs is false', async () => {
    const runner = new ContainerRunner();
    await runner.start(
      makeAgentDef({
        containerConfig: {
          image: 'clawix-agent:latest',
          cpuLimit: '0.5',
          memoryLimit: '512m',
          timeoutSeconds: 30,
          readOnlyRootfs: false,
          allowedMounts: [],
        },
      }),
    );

    const [, args] = mockExecFileAsync.mock.calls[0] as [string, string[]];

    expect(args).not.toContain('--read-only');
  });

  it('includes --label clawix.timeout=<seconds>', async () => {
    const runner = new ContainerRunner();
    await runner.start(
      makeAgentDef({
        containerConfig: {
          image: 'clawix-agent:latest',
          cpuLimit: '0.5',
          memoryLimit: '512m',
          timeoutSeconds: 60,
          readOnlyRootfs: true,
          allowedMounts: [],
        },
      }),
    );

    const [, args] = mockExecFileAsync.mock.calls[0] as [string, string[]];

    const labelIdx = args.indexOf('--label');
    expect(labelIdx).toBeGreaterThanOrEqual(0);
    expect(args[labelIdx + 1]).toBe('clawix.timeout=60');
  });

  it('includes --network none and --user 1000:1000', async () => {
    const runner = new ContainerRunner();
    await runner.start(makeAgentDef());

    const [, args] = mockExecFileAsync.mock.calls[0] as [string, string[]];

    expect(args).toContain('--network');
    expect(args).toContain('none');
    expect(args).toContain('--user');
    expect(args).toContain('1000:1000');
  });

  it('adds -v workspace mount when workspaceHostPath is provided', async () => {
    const runner = new ContainerRunner();
    await runner.start(makeAgentDef(), [], {
      workspaceHostPath: '/host/data/users/u1/workspace',
    });

    const [, args] = mockExecFileAsync.mock.calls[0] as [string, string[]];

    const vIdx = args.indexOf('-v');
    expect(vIdx).toBeGreaterThanOrEqual(0);
    // Find the workspace mount specifically
    const volumeFlags: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-v') {
        volumeFlags.push(args[i + 1]!);
      }
    }
    expect(volumeFlags).toContain('/host/data/users/u1/workspace:/workspace');
  });

  it('omits workspace mount when workspaceHostPath is not provided', async () => {
    const runner = new ContainerRunner();
    await runner.start(makeAgentDef());

    const [, args] = mockExecFileAsync.mock.calls[0] as [string, string[]];

    const volumeFlags: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-v') {
        volumeFlags.push(args[i + 1]!);
      }
    }
    const workspaceMount = volumeFlags.find((f) => f.endsWith(':/workspace'));
    expect(workspaceMount).toBeUndefined();
  });

  it('throws when docker run fails', async () => {
    mockExecFileAsync.mockRejectedValue(new Error('docker: command not found'));

    const runner = new ContainerRunner();
    await expect(runner.start(makeAgentDef())).rejects.toThrow('docker: command not found');
  });

  it('does not schedule auto-stop when disableAutoStop is true', async () => {
    vi.useFakeTimers();
    const runner = new ContainerRunner();
    await runner.start(makeAgentDef(), [], { disableAutoStop: true });

    // Advance past the timeout — container should NOT be stopped
    mockExecFileAsync.mockClear();
    await vi.advanceTimersByTimeAsync(31_000);

    // If auto-stop fired, it would call docker stop/kill/rm.
    // With disableAutoStop, no calls should have been made.
    expect(mockExecFileAsync).not.toHaveBeenCalled();
  });

  it('schedules auto-stop by default when disableAutoStop is not set', async () => {
    vi.useFakeTimers();
    const runner = new ContainerRunner();
    await runner.start(
      makeAgentDef({
        containerConfig: {
          image: 'clawix-agent:latest',
          cpuLimit: '0.5',
          memoryLimit: '512m',
          timeoutSeconds: 5,
          readOnlyRootfs: true,
          allowedMounts: [],
        },
      }),
    );

    mockExecFileAsync.mockClear();
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
    await vi.advanceTimersByTimeAsync(5_001);

    // Auto-stop should have fired — docker stop/kill/rm calls expected
    expect(mockExecFileAsync).toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ //
//  exec()                                                             //
// ------------------------------------------------------------------ //

describe('ContainerRunner.exec()', () => {
  it('executes a command and returns ExecResult with exitCode 0', async () => {
    const runner = new ContainerRunner();
    await runner.start(makeAgentDef());

    mockExecFileAsync.mockResolvedValue({ stdout: 'hello world', stderr: '' });
    const result = await runner.exec('abc123', ['echo', 'hello']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello world');

    // Verify the exec call args
    const [cmd, args] = mockExecFileAsync.mock.calls[1] as [string, string[]];
    expect(cmd).toBe('docker');
    expect(args[0]).toBe('exec');
    expect(args).toContain('abc123');
  });

  it('returns non-zero exit code on failure', async () => {
    const runner = new ContainerRunner();
    await runner.start(makeAgentDef());

    const err = Object.assign(new Error('command failed'), {
      code: 1,
      stdout: '',
      stderr: 'command not found',
    });
    mockExecFileAsync.mockRejectedValue(err);

    const result = await runner.exec('abc123', ['false']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('command not found');
  });

  it('passes -w flag when workdir option is provided', async () => {
    const runner = new ContainerRunner();
    await runner.start(makeAgentDef());

    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
    await runner.exec('abc123', ['ls'], { workdir: '/workspace/sub' });

    const [, args] = mockExecFileAsync.mock.calls[1] as [string, string[]];
    const wIdx = args.indexOf('-w');
    expect(wIdx).toBeGreaterThanOrEqual(0);
    expect(args[wIdx + 1]).toBe('/workspace/sub');
  });
});

// ------------------------------------------------------------------ //
//  stop()                                                             //
// ------------------------------------------------------------------ //

describe('ContainerRunner.stop()', () => {
  it('calls docker stop and docker rm', async () => {
    const runner = new ContainerRunner();
    await runner.start(makeAgentDef());

    // Clear mock to track only stop-related calls
    mockExecFileAsync.mockClear();
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

    await runner.stop('abc123');

    const allArgs = mockExecFileAsync.mock.calls.map(([, args]) => args as string[]);
    const hasStop = allArgs.some((a) => a.includes('stop'));
    const hasRm = allArgs.some((a) => a.includes('rm'));

    expect(hasStop).toBe(true);
    expect(hasRm).toBe(true);
  });
});

// ------------------------------------------------------------------ //
//  exec with AbortSignal                                              //
// ------------------------------------------------------------------ //

describe('exec with AbortSignal', () => {
  it('rejects with abort error when signal is already aborted', async () => {
    // Make the mock honor the signal: if signal is provided and aborted,
    // throw an ABORT_ERR-shaped error.
    mockExecFileAsync.mockImplementation((_cmd, _args, options?: { signal?: AbortSignal }) => {
      if (options?.signal?.aborted) {
        const err = new Error('aborted') as NodeJS.ErrnoException;
        err.code = 'ABORT_ERR';
        return Promise.reject(err);
      }
      return Promise.resolve({ stdout: '', stderr: '' });
    });

    const runner = new ContainerRunner();
    const controller = new AbortController();
    controller.abort();

    const result = await runner.exec('container-1', ['sleep', '30'], {
      signal: controller.signal,
    });

    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toMatch(/abort/i);
  });

  it('passes signal option to execFile', async () => {
    let seenSignal: AbortSignal | undefined;
    mockExecFileAsync.mockImplementation((_cmd, _args, options?: { signal?: AbortSignal }) => {
      seenSignal = options?.signal;
      return Promise.resolve({ stdout: 'ok', stderr: '' });
    });

    const runner = new ContainerRunner();
    const controller = new AbortController();

    await runner.exec('container-1', ['echo', 'hi'], { signal: controller.signal });

    expect(seenSignal).toBe(controller.signal);
  });

  it('preserves buffered stdout when stdin path is aborted mid-flight', async () => {
    // Build a minimal EventEmitter-like child process stub that:
    // 1. Emits buffered data on stdout before the abort error arrives
    // 2. Emits error(ABORT_ERR) followed by close(null, 'SIGTERM')
    const { EventEmitter } = await import('events');

    const fakeChild = {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { write: vi.fn(), end: vi.fn() },
      on: vi.fn(),
    };

    // Collect event listeners registered via proc.on(...)
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    (fakeChild.on as ReturnType<typeof vi.fn>).mockImplementation(
      (event: string, cb: (...args: unknown[]) => void) => {
        listeners[event] ??= [];
        listeners[event]!.push(cb);
      },
    );

    mockSpawn.mockReturnValue(fakeChild);

    const runner = new ContainerRunner();
    const controller = new AbortController();

    // Kick off exec — uses spawn path because stdin is provided
    const execPromise = runner.exec('container-1', ['cat'], {
      stdin: 'input data',
      signal: controller.signal,
    });

    // Simulate stdout arriving before abort
    fakeChild.stdout.emit('data', Buffer.from('partial output'));

    // Simulate the abort sequence: error(ABORT_ERR) then close(null, SIGTERM)
    controller.abort();
    const abortErr = Object.assign(new Error('aborted'), { code: 'ABORT_ERR' });
    for (const cb of listeners['error'] ?? []) cb(abortErr);
    for (const cb of listeners['close'] ?? []) cb(null, 'SIGTERM');

    const result = await execPromise;

    expect(result.exitCode).toBe(-1);
    expect(result.stdout).toBe('partial output');
    expect(result.stderr).toMatch(/exec aborted|aborted/i);
  });

  it('applies the clamped timeout to the stdin exec path (exitCode 124)', async () => {
    const { EventEmitter } = await import('events');

    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    const fakeChild = {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { write: vi.fn(), end: vi.fn() },
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        listeners[event] ??= [];
        listeners[event]!.push(cb);
      }),
      // The kill from the timeout timer terminates the child, which then closes.
      kill: vi.fn(() => {
        for (const cb of listeners['close'] ?? []) cb(null, 'SIGTERM');
      }),
    };
    mockSpawn.mockReturnValue(fakeChild);

    const runner = new ContainerRunner();
    const result = await runner.exec('container-1', ['sleep', 'infinity'], {
      stdin: 'input',
      timeout: 30,
    });

    expect(fakeChild.kill).toHaveBeenCalled();
    expect(result.exitCode).toBe(124);
    expect(result.stderr).toContain('timed out after 30ms');
  });

  it('caps accumulated stdin-path output at MAX_STDIO_BUFFER_BYTES and kills the process', async () => {
    const { EventEmitter } = await import('events');

    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    const fakeChild = {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { write: vi.fn(), end: vi.fn() },
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        listeners[event] ??= [];
        listeners[event]!.push(cb);
      }),
      kill: vi.fn(() => {
        for (const cb of listeners['close'] ?? []) cb(null, 'SIGKILL');
      }),
    };
    mockSpawn.mockReturnValue(fakeChild);

    const runner = new ContainerRunner();
    const execPromise = runner.exec('container-1', ['yes'], { stdin: 'input' });

    // One chunk larger than the cap: buffered output must be cut at the cap.
    fakeChild.stdout.emit('data', Buffer.alloc(MAX_STDIO_BUFFER_BYTES + 4096, 0x61));

    const result = await execPromise;

    expect(fakeChild.kill).toHaveBeenCalled();
    expect(result.stdout.length).toBe(MAX_STDIO_BUFFER_BYTES);
    expect(result.stderr).toContain(`truncated at ${MAX_STDIO_BUFFER_BYTES} bytes`);
  });
});

// ------------------------------------------------------------------ //
//  buildDockerRunArgs — egress firewall                              //
// ------------------------------------------------------------------ //

describe('buildDockerRunArgs egress firewall', () => {
  it('adds NET_ADMIN + root user + allowlist env when egressFirewall is set', () => {
    const args = buildDockerRunArgs({
      agentDef: makeAgentDef(),
      containerName: 'c',
      validatedMounts: [],
      network: 'clawix-python-net-egress',
      egressFirewall: true,
      egressAllowlist: 'a.test:3001',
    });
    expect(args).toContain('--cap-add');
    expect(args).toContain('NET_ADMIN');
    // starts as root, NOT 1000:1000
    const i = args.indexOf('--user');
    expect(args[i + 1]).toBe('0:0');
    expect(args).not.toContain('1000:1000');
    // allowlist env passed through
    expect(args).toContain('EGRESS_ALLOWLIST=a.test:3001');
  });

  it('is byte-identical to today when egressFirewall is absent', () => {
    const args = buildDockerRunArgs({
      agentDef: makeAgentDef(),
      containerName: 'c',
      validatedMounts: [],
    });
    expect(args).toContain('1000:1000');
    expect(args).not.toContain('NET_ADMIN');
    expect(args.join(' ')).not.toContain('EGRESS_ALLOWLIST');
    // Snapshot the full arg vector so positional / ordering drift is caught,
    // not just membership — this is the "byte-identical no-net path" guarantee.
    expect(args).toMatchSnapshot();
  });
});

// ------------------------------------------------------------------ //
//  buildDockerExecArgs — user option                                 //
// ------------------------------------------------------------------ //

describe('buildDockerExecArgs', () => {
  it('adds --user when user option is set', () => {
    const args = buildDockerExecArgs('cid', ['sh', '-c', 'echo hi'], { user: '1000:1000' });
    const i = args.indexOf('--user');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('1000:1000');
    expect(args).toEqual(expect.arrayContaining(['exec', 'cid', 'sh', '-c', 'echo hi']));
  });

  it('omits --user when not set (unchanged behavior)', () => {
    const args = buildDockerExecArgs('cid', ['ls'], {});
    expect(args).not.toContain('--user');
    expect(args).toEqual(['exec', 'cid', 'ls']);
  });
});
