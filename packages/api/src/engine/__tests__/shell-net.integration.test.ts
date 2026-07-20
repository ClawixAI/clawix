import { execFile as execFileCb } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ContainerRunner } from '../container-runner.js';
import { createShellNetTool } from '../tools/shell-net.js';
import { ShellNetConcurrencyLimiter } from '../tools/shell-net-concurrency-limiter.js';
import type { Tool } from '../tool.js';

const execFile = promisify(execFileCb);

const RUNNER_IMAGE = 'clawix-shell-net-runner:latest';
const NETWORK_NAME = 'clawix-python-net-egress';

// ------------------------------------------------------------------ //
//  Docker / prerequisite availability checks                          //
// ------------------------------------------------------------------ //

async function isDockerAvailable(): Promise<boolean> {
  try {
    await execFile('docker', ['info'], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function isImagePresent(image: string): Promise<boolean> {
  try {
    const { stdout } = await execFile('docker', ['images', '-q', image], { timeout: 5_000 });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function isNetworkPresent(network: string): Promise<boolean> {
  try {
    const { stdout } = await execFile(
      'docker',
      ['network', 'ls', '-q', '--filter', `name=${network}`],
      {
        timeout: 5_000,
      },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

const dockerAvailable = await isDockerAvailable();
const isCI = process.env['CI'] === 'true';
const imagePresent = dockerAvailable ? await isImagePresent(RUNNER_IMAGE) : false;
const networkPresent = dockerAvailable ? await isNetworkPresent(NETWORK_NAME) : false;

// This is a LIVE ACCEPTANCE PROOF, not a mocked unit test: it must actually run
// the real shell_net tool code path against a real ephemeral container on the
// real egress network. If any prerequisite is missing, skip loudly rather than
// silently — a skip here means the proof did NOT execute.
const canRun = dockerAvailable && !isCI && imagePresent && networkPresent;

if (!canRun) {
  console.warn(
    `[shell-net.integration] SKIPPING live proof — dockerAvailable=${dockerAvailable} isCI=${isCI} ` +
      `imagePresent(${RUNNER_IMAGE})=${imagePresent} networkPresent(${NETWORK_NAME})=${networkPresent}. ` +
      'This is NOT an acceptance proof if skipped.',
  );
}

describe.skipIf(!canRun)('shell_net live acceptance proof (real Docker + real network)', () => {
  let runner: ContainerRunner;
  let limiter: ShellNetConcurrencyLimiter;
  let tool: Tool;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'clawix-shell-net-integration-'));

    runner = new ContainerRunner();
    limiter = new ShellNetConcurrencyLimiter();

    tool = createShellNetTool({
      userId: 'shell-net-proof-user',
      workspaceHostPath: tmpDir,
      policy: {
        allowShellNet: true,
        maxShellNetMemoryMb: 8192,
        maxShellNetTimeoutSecs: 600,
        maxShellNetCpuCores: 4,
        maxConcurrentShellNetRuns: 5,
      },
      runner,
      limiter,
    });
  }, 60_000);

  afterAll(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('executes an agent-authored curl through the real ephemeral container and reaches example.com', async () => {
    const result = await tool.execute(
      { command: 'curl -s -o /dev/null -w "%{http_code}" https://example.com' },
      { abortSignal: new AbortController().signal },
    );

    console.log('[shell-net.integration] tool result:', JSON.stringify(result));

    expect(result.isError).toBe(false);
    expect(result.output).toContain('200');
  }, 120_000);
});
