/**
 * ContainerRunner — manages long-lived Docker containers via the Docker CLI.
 *
 * Lifecycle:
 *   start() — spawns a detached container, returns the container ID.
 *   exec()  — runs a command inside a running container via `docker exec`.
 *   stop()  — tears down the container (stop → kill → rm).
 *
 * Security hardening:
 *   - Non-root user (1000:1000)
 *   - Network isolation (--network none)
 *   - PID limit (--pids-limit 256)
 *   - No-new-privileges seccomp option
 *   - Optional read-only rootfs + tmpfs
 *   - All mounts validated by validateMounts() before use
 */
import { execFile as execFileCb, spawn } from 'child_process';
import { promisify } from 'util';

import { Injectable } from '@nestjs/common';
import { createLogger } from '@clawix/shared';
import type {
  AgentDefinition,
  AgentMount,
  ExecOptions,
  ExecResult,
  ValidatedMount,
} from '@clawix/shared';

import { loadAllowlist, validateMounts } from './mount-security.js';

// ------------------------------------------------------------------ //
//  Constants                                                          //
// ------------------------------------------------------------------ //

/** Default timeout for a single exec() call in milliseconds. */
export const DEFAULT_EXEC_TIMEOUT_MS = 60_000;

/** Maximum allowed exec timeout in milliseconds. */
export const MAX_EXEC_TIMEOUT_MS = 600_000;

/** Grace period in seconds given to `docker stop` before a kill. */
export const STOP_GRACE_SECONDS = 10;

/** Path to the host-level mount allowlist configuration. */
const ALLOWLIST_PATH =
  process.env['CLAWIX_MOUNT_ALLOWLIST'] ??
  `${process.env['HOME'] ?? '/root'}/.config/clawix/mount-allowlist.json`;

const logger = createLogger('engine:container-runner');

const execFileAsync = promisify(execFileCb);

// ------------------------------------------------------------------ //
//  StartOptions interface                                             //
// ------------------------------------------------------------------ //

/** Options for starting a container. */
export interface StartOptions {
  readonly disableAutoStop?: boolean;
  /**
   * Absolute host path to mount as /workspace inside the agent container.
   * Must be a host-visible path (not a container-local path) because the
   * Docker daemon resolves -v paths on the host filesystem.
   */
  readonly workspaceHostPath?: string;
  /** Skill directory mounts (trusted system mounts, bypass validateMounts). */
  readonly skillMounts?: {
    readonly builtinHostPath: string;
    readonly customHostPath: string;
  };
}

// ------------------------------------------------------------------ //
//  IContainerRunner interface                                         //
// ------------------------------------------------------------------ //

/**
 * Interface for the container runner, exported for testability and DI.
 */
export interface IContainerRunner {
  /** Validate mounts, spawn the container, and return its container ID. */
  start(
    agentDef: AgentDefinition,
    additionalMounts?: readonly AgentMount[],
    options?: StartOptions,
  ): Promise<string>;

  /** Execute a command inside a running container. */
  exec(containerId: string, command: readonly string[], options?: ExecOptions): Promise<ExecResult>;

  /** Stop, kill, and remove the container. */
  stop(containerId: string): Promise<void>;
}

// ------------------------------------------------------------------ //
//  ContainerRunner                                                    //
// ------------------------------------------------------------------ //

/**
 * Manages long-lived Docker containers via the Docker CLI child process.
 */
@Injectable()
export class ContainerRunner implements IContainerRunner {
  /** Maps containerId → NodeJS.Timeout for the auto-stop timer. */
  private readonly timeoutHandles = new Map<string, ReturnType<typeof setTimeout>>();

  // ---------------------------------------------------------------- //
  //  start()                                                          //
  // ---------------------------------------------------------------- //

  /**
   * Start a new Docker container for the given agent definition.
   *
   * @param agentDef - The agent definition containing container config.
   * @param additionalMounts - Extra mounts beyond those in agentDef (e.g. task-specific).
   * @returns The container ID (trimmed stdout from `docker run`).
   * @throws If mount validation fails or `docker run` exits non-zero.
   */
  async start(
    agentDef: AgentDefinition,
    additionalMounts: readonly AgentMount[] = [],
    options: StartOptions = {},
  ): Promise<string> {
    const { containerConfig } = agentDef;
    const allRequestedMounts: readonly AgentMount[] = [
      ...containerConfig.allowedMounts,
      ...additionalMounts,
    ];

    // Validate all mounts before touching Docker
    const allowlist = loadAllowlist(ALLOWLIST_PATH);
    const validatedMounts: ValidatedMount[] =
      allRequestedMounts.length > 0
        ? validateMounts(allRequestedMounts, allowlist, containerConfig.allowedMounts)
        : [];

    const containerName = `clawix-agent-${agentDef.id}-${Date.now()}`;

    const args = buildDockerRunArgs({
      agentDef,
      containerName,
      validatedMounts,
      workspaceHostPath: options.workspaceHostPath,
      skillMounts: options.skillMounts,
    });

    logger.info(
      { agentId: agentDef.id, containerName, image: containerConfig.image },
      'Starting container',
    );

    const { stdout } = await execFileAsync('docker', args);
    const containerId = stdout.trim();

    logger.info({ agentId: agentDef.id, containerId }, 'Container started');

    // Schedule auto-stop when the container timeout expires (unless disabled for pool-managed containers)
    if (options.disableAutoStop !== true) {
      this.scheduleAutoStop(containerId, containerConfig.timeoutSeconds);
    }

    return containerId;
  }

  // ---------------------------------------------------------------- //
  //  exec()                                                           //
  // ---------------------------------------------------------------- //

  /**
   * Execute a command inside a running container.
   *
   * If `options.stdin` is provided, falls back to `spawn` to support
   * piping stdin (execFile does not support this).
   *
   * @param containerId - The Docker container ID to execute inside.
   * @param command - The command and its arguments.
   * @param options - Optional workdir, stdin, and timeout.
   * @returns ExecResult with exitCode, stdout, and stderr.
   */
  async exec(
    containerId: string,
    command: readonly string[],
    options: ExecOptions = {},
  ): Promise<ExecResult> {
    const { stdin, workdir, timeout: rawTimeout } = options;

    const timeoutMs = Math.min(rawTimeout ?? DEFAULT_EXEC_TIMEOUT_MS, MAX_EXEC_TIMEOUT_MS);

    const args: string[] = ['exec'];

    if (workdir !== undefined) {
      args.push('-w', workdir);
    }

    if (stdin !== undefined) {
      args.push('-i');
    }

    args.push(containerId, ...command);

    logger.debug({ containerId, command, workdir }, 'Executing command in container');

    if (stdin !== undefined) {
      return this.execWithStdin(args, stdin);
    }

    return this.execWithTimeout(args, timeoutMs);
  }

  // ---------------------------------------------------------------- //
  //  stop()                                                           //
  // ---------------------------------------------------------------- //

  /**
   * Stop, kill, and remove the container. Clears the auto-stop timer.
   * All sub-commands catch errors so a partially-torn-down container
   * does not prevent cleanup of the remaining steps.
   *
   * @param containerId - The Docker container ID to tear down.
   */
  async stop(containerId: string): Promise<void> {
    // Clear the auto-stop timer if it exists
    const handle = this.timeoutHandles.get(containerId);
    if (handle !== undefined) {
      clearTimeout(handle);
      this.timeoutHandles.delete(containerId);
    }

    logger.info({ containerId }, 'Stopping container');

    await execFileAsync('docker', ['stop', `-t`, String(STOP_GRACE_SECONDS), containerId]).catch(
      (err: unknown) => {
        logger.warn({ containerId, err }, 'docker stop failed (container may already be stopped)');
      },
    );

    await execFileAsync('docker', ['kill', containerId]).catch((err: unknown) => {
      logger.warn({ containerId, err }, 'docker kill failed (container may already be dead)');
    });

    await execFileAsync('docker', ['rm', '-f', containerId]).catch((err: unknown) => {
      logger.warn({ containerId, err }, 'docker rm failed');
    });

    logger.info({ containerId }, 'Container removed');
  }

  // ---------------------------------------------------------------- //
  //  Private helpers                                                  //
  // ---------------------------------------------------------------- //

  /**
   * Run `docker exec` with a timeout using the promisified execFile.
   * Returns exitCode 124 if the timeout fires before the command completes.
   */
  private async execWithTimeout(args: string[], timeoutMs: number): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await execFileAsync('docker', args, { timeout: timeoutMs });
      return { exitCode: 0, stdout, stderr };
    } catch (err: unknown) {
      // execFile rejects with an error that may carry .code (process exit code)
      // or .killed / signal for timeout scenarios.
      if (isExecError(err)) {
        if (err.killed === true || err.signal === 'SIGTERM') {
          return {
            exitCode: 124,
            stdout: err.stdout ?? '',
            stderr: err.stderr ?? 'exec timed out',
          };
        }
        return {
          exitCode: typeof err.code === 'number' ? err.code : 1,
          stdout: err.stdout ?? '',
          stderr: err.stderr ?? (err instanceof Error ? err.message : String(err)),
        };
      }
      return {
        exitCode: 1,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Run `docker exec -i` via spawn to support piping stdin.
   * Collects stdout/stderr buffers, writes stdin, and resolves on 'close'.
   */
  private execWithStdin(args: string[], stdinData: string): Promise<ExecResult> {
    return new Promise((resolve) => {
      const proc = spawn('docker', args);
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      proc.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      proc.on('close', (code: number | null) => {
        resolve({
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
        });
      });

      proc.on('error', (err: Error) => {
        resolve({ exitCode: 1, stdout: '', stderr: err.message });
      });

      proc.stdin.write(stdinData);
      proc.stdin.end();
    });
  }

  /** Register an auto-stop timer for the given container. */
  private scheduleAutoStop(containerId: string, timeoutSeconds: number): void {
    const handle = setTimeout(() => {
      logger.warn({ containerId, timeoutSeconds }, 'Container timeout expired — stopping');
      void this.stop(containerId);
    }, timeoutSeconds * 1000);

    // Allow the process to exit even if the timer is still pending
    if (
      typeof handle === 'object' &&
      handle !== null &&
      typeof (handle as NodeJS.Timeout).unref === 'function'
    ) {
      (handle as NodeJS.Timeout).unref();
    }

    this.timeoutHandles.set(containerId, handle);
  }
}

// ------------------------------------------------------------------ //
//  docker run argument builder                                        //
// ------------------------------------------------------------------ //

interface DockerRunArgsParams {
  readonly agentDef: AgentDefinition;
  readonly containerName: string;
  readonly validatedMounts: readonly ValidatedMount[];
  readonly workspaceHostPath?: string;
  readonly skillMounts?: StartOptions['skillMounts'];
}

/**
 * Build the full argument list for `docker run`.
 * Kept as a pure function to simplify testing and reasoning.
 */
export function buildDockerRunArgs(params: DockerRunArgsParams): string[] {
  const { agentDef, containerName, validatedMounts } = params;
  const { containerConfig } = agentDef;

  const args: string[] = [
    'run',
    '-d',
    '--name',
    containerName,
    '--user',
    '1000:1000',
    '--network',
    'none',
    '--cpus',
    containerConfig.cpuLimit,
    '--memory',
    containerConfig.memoryLimit,
    '--pids-limit',
    '256',
    '--ulimit',
    'nofile=1024:1024',
    '--security-opt',
    'no-new-privileges',
    '--label',
    `clawix.timeout=${containerConfig.timeoutSeconds}`,
    '-e',
    `TZ=${process.env['TZ'] ?? 'UTC'}`,
  ];

  if (containerConfig.readOnlyRootfs) {
    args.push('--read-only');
    args.push('--tmpfs', '/tmp:rw,noexec,nosuid,size=64m');
  }

  // Mount the per-user workspace as /workspace (the agent's working directory)
  if (params.workspaceHostPath !== undefined) {
    args.push('-v', `${params.workspaceHostPath}:/workspace`);
  }

  // Mount skill directories (trusted system mounts, not validated through mount-security)
  if (params.skillMounts !== undefined) {
    args.push('-v', `${params.skillMounts.builtinHostPath}:/skills/builtin:ro`);
    args.push('-v', `${params.skillMounts.customHostPath}:/skills/custom`);
  }

  for (const mount of validatedMounts) {
    const flag = mount.readonly
      ? `${mount.hostPath}:${mount.containerPath}:ro`
      : `${mount.hostPath}:${mount.containerPath}`;
    args.push('-v', flag);
  }

  args.push(containerConfig.image);

  // Keep the container alive — the default entrypoint (e.g. `node`)
  // exits immediately in detached mode with no TTY/stdin.
  args.push('sleep', 'infinity');

  return args;
}

// ------------------------------------------------------------------ //
//  cleanupOrphanContainers                                            //
// ------------------------------------------------------------------ //

/**
 * Scan for clawix-agent containers that have exceeded 2× their labeled timeout
 * and kill them. Intended to be called on startup or by a periodic cron.
 */
export async function cleanupOrphanContainers(): Promise<void> {
  const cleanupLogger = createLogger('engine:container-runner:cleanup');

  let listOutput: string;
  try {
    const { stdout } = await execFileAsync('docker', [
      'ps',
      '--filter',
      'name=clawix-agent-',
      '--format',
      '{{.ID}}\t{{.Names}}\t{{.Label "clawix.timeout"}}',
    ]);
    listOutput = stdout.trim();
  } catch (err: unknown) {
    cleanupLogger.error({ err }, 'Failed to list clawix-agent containers');
    return;
  }

  if (listOutput.length === 0) {
    return;
  }

  const lines = listOutput.split('\n');
  const now = Date.now();

  await Promise.all(
    lines.map(async (line) => {
      const parts = line.split('\t');
      const [containerId, , timeoutLabel] = parts as [string, string, string | undefined];

      if (!containerId) return;

      const timeoutSeconds = timeoutLabel !== undefined ? parseInt(timeoutLabel, 10) : NaN;
      if (isNaN(timeoutSeconds)) {
        cleanupLogger.debug({ containerId }, 'No timeout label — skipping cleanup check');
        return;
      }

      // Inspect the container start time
      let startedAtMs: number;
      try {
        const { stdout: inspectOut } = await execFileAsync('docker', [
          'inspect',
          '--format',
          '{{.State.StartedAt}}',
          containerId,
        ]);
        startedAtMs = new Date(inspectOut.trim()).getTime();
      } catch {
        cleanupLogger.warn({ containerId }, 'Failed to inspect container — skipping');
        return;
      }

      const runningMs = now - startedAtMs;
      const thresholdMs = timeoutSeconds * 2 * 1000;

      if (runningMs > thresholdMs) {
        cleanupLogger.warn(
          { containerId, runningMs, thresholdMs },
          'Killing orphan container that exceeded 2× timeout',
        );
        await execFileAsync('docker', ['rm', '-f', containerId]).catch((err: unknown) => {
          cleanupLogger.error({ containerId, err }, 'Failed to remove orphan container');
        });
      }
    }),
  );
}

// ------------------------------------------------------------------ //
//  Type guards                                                        //
// ------------------------------------------------------------------ //

interface ExecError {
  readonly code?: number | string;
  readonly killed?: boolean;
  readonly signal?: string;
  readonly stdout?: string;
  readonly stderr?: string;
}

function isExecError(err: unknown): err is ExecError {
  return typeof err === 'object' && err !== null;
}
