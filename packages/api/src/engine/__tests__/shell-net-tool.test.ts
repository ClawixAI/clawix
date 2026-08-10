import { describe, it, expect, vi } from 'vitest';
import { createShellNetTool, shellNetApprovalWarnings, ShellNetDeps } from '../tools/shell-net.js';

const policy = {
  allowShellNet: true,
  maxShellNetMemoryMb: 2048,
  maxShellNetTimeoutSecs: 300,
  maxShellNetCpuCores: 2,
  maxConcurrentShellNetRuns: 3,
};

function makeDeps(overrides: Partial<ShellNetDeps> = {}): ShellNetDeps {
  return {
    userId: 'u1',
    workspaceHostPath: '/tmp/ws-s1',
    policy,
    runner: {
      start: vi.fn(async () => 'c-eph-1'),
      exec: vi.fn(async () => ({ exitCode: 0, stdout: 'ok', stderr: '' })),
      stop: vi.fn(async () => undefined),
    },
    limiter: { acquire: vi.fn(), release: vi.fn() },
    ...overrides,
  } as unknown as ShellNetDeps;
}

const sig = () => ({ abortSignal: new AbortController().signal });

describe('shell_net tool', () => {
  it('is whole-tool run-scoped approval-gated', () => {
    const tool = createShellNetTool(makeDeps());
    expect(tool.name).toBe('shell_net');
    expect(tool.requiresApproval).toBe(true);
    expect(tool.approvalScope).toBe('run');
  });

  it('starts an ephemeral container on the egress network and stops it', async () => {
    const deps = makeDeps();
    const tool = createShellNetTool(deps);
    await tool.execute({ command: 'curl https://example.com' }, sig());
    expect(deps.runner.start).toHaveBeenCalledOnce();
    const startArgs = (deps.runner.start as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(startArgs[2]).toMatchObject({
      network: 'clawix-python-net-egress',
      egressFirewall: true,
    });
    expect(deps.runner.stop).toHaveBeenCalledWith('c-eph-1');
  });

  it('runs the command as uid 1000 via the exec user option', async () => {
    const deps = makeDeps();
    await createShellNetTool(deps).execute({ command: 'curl x' }, sig());
    const execCall = (deps.runner.exec as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(execCall[2]).toMatchObject({ user: '1000:1000' });
  });

  it('blocks deny-pattern commands BEFORE starting a container', async () => {
    const deps = makeDeps();
    const tool = createShellNetTool(deps);
    const res = await tool.execute({ command: 'rm -rf /' }, sig());
    expect(res.isError).toBe(true);
    expect(deps.runner.start).not.toHaveBeenCalled();
    expect(deps.limiter.acquire).not.toHaveBeenCalled();
  });

  it('errors when command is empty', async () => {
    const deps = makeDeps();
    const res = await createShellNetTool(deps).execute({ command: '  ' }, sig());
    expect(res.isError).toBe(true);
    expect(deps.runner.start).not.toHaveBeenCalled();
  });

  it('errors when allowShellNet is false', async () => {
    const deps = makeDeps({ policy: { ...policy, allowShellNet: false } });
    const res = await createShellNetTool(deps).execute({ command: 'curl x' }, sig());
    expect(res.isError).toBe(true);
    expect(deps.runner.start).not.toHaveBeenCalled();
  });

  it('stops the container even when exec throws', async () => {
    const deps = makeDeps({
      runner: {
        start: vi.fn(async () => 'c-eph-2'),
        exec: vi.fn(async () => {
          throw new Error('boom');
        }),
        stop: vi.fn(async () => undefined),
      },
    });
    await createShellNetTool(deps).execute({ command: 'curl x' }, sig());
    expect(deps.runner.stop).toHaveBeenCalledWith('c-eph-2');
    expect(deps.limiter.release).toHaveBeenCalledWith('u1');
  });

  it('passes the capped timeout to exec in milliseconds', async () => {
    const execMock = vi.fn(async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }));
    const deps = makeDeps({
      runner: { start: vi.fn(async () => 'c'), exec: execMock, stop: vi.fn(async () => undefined) },
    });
    await createShellNetTool(deps).execute({ command: 'curl x', timeoutSecs: 30 }, sig());
    expect(execMock.mock.calls[0][2]).toMatchObject({ timeout: 30_000 });
  });
});

describe('shellNetApprovalWarnings', () => {
  const warnsFor = (command: string): readonly string[] => shellNetApprovalWarnings({ command });

  it('flags python / pip / poetry / conda / uv tokens', () => {
    expect(warnsFor('python script.py').length).toBeGreaterThan(0);
    expect(warnsFor('python3 -m venv /tmp/v').length).toBeGreaterThan(0);
    expect(warnsFor('pip install requests').length).toBeGreaterThan(0);
    expect(warnsFor('pip3 install -r requirements.txt').length).toBeGreaterThan(0);
    expect(warnsFor('pipx run httpx').length).toBeGreaterThan(0);
    expect(warnsFor('poetry add fastapi').length).toBeGreaterThan(0);
    expect(warnsFor('conda install numpy').length).toBeGreaterThan(0);
    expect(warnsFor('uv pip install -r requirements.txt').length).toBeGreaterThan(0);
  });

  it('catches a python invocation buried in a multi-stage pipeline', () => {
    expect(
      warnsFor('apt-get update && apt-get install -y python3 && python3 -c "print(1)"').length,
    ).toBeGreaterThan(0);
  });

  it('catches a venv-activation + pip pattern', () => {
    expect(
      warnsFor('. venv/bin/activate && pip install -r requirements.txt').length,
    ).toBeGreaterThan(0);
  });

  it('catches a curl-pipe-python-tarball download interpreter', () => {
    expect(
      warnsFor('curl -L https://.../python3.tar.gz | tar xz && ./python/bin/python3 script.py')
        .length,
    ).toBeGreaterThan(0);
  });

  it('does NOT flag legitimate shell network ops (curl/git/ssh/jq)', () => {
    expect(warnsFor('curl -s -o /dev/null -w "%{http_code}" https://example.com')).toEqual([]);
    expect(warnsFor('git clone https://example.com/repo.git')).toEqual([]);
    expect(warnsFor('ssh -t host.example.com ./deploy.sh')).toEqual([]);
    expect(warnsFor('echo {} | jq .field')).toEqual([]);
  });

  it('does NOT flag a word that merely contains "python" as a substring', () => {
    expect(warnsFor('echo montypython_fan')).toEqual([]);
    expect(warnsFor('echo MYPYTHON_ENV')).toEqual([]);
    expect(warnsFor('cat /etc/passwd')).toEqual([]);
  });

  it('DOES flag a python invocation that uses a full path', () => {
    expect(warnsFor('/usr/local/bin/python3 -c pass').length).toBeGreaterThan(0);
    expect(warnsFor('/usr/bin/pip3 install requests').length).toBeGreaterThan(0);
  });

  it('does NOT uppercase-match tokens (regex is case-sensitive by design)', () => {
    expect(warnsFor('PYTHON script.py')).toEqual([]);
    expect(warnsFor('echo $PYTHONPATH')).toEqual([]);
  });

  it('returns [] when command is missing or non-string', () => {
    expect(shellNetApprovalWarnings({})).toEqual([]);
    expect(shellNetApprovalWarnings({ command: 42 })).toEqual([]);
    expect(shellNetApprovalWarnings({ command: '' })).toEqual([]);
  });

  it('is wired on the tool as approvalWarningsForParams', () => {
    const tool = createShellNetTool(makeDeps());
    expect(typeof tool.approvalWarningsForParams).toBe('function');
    expect(tool.approvalWarningsForParams?.({ command: 'python3 -c pass' }).length).toBeGreaterThan(
      0,
    );
    expect(tool.approvalWarningsForParams?.({ command: 'curl example.com' })).toEqual([]);
  });
});
