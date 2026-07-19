/**
 * shell_net tool factory — network-enabled ephemeral shell execution.
 *
 * Mirrors python_run_net: each call spawns a fresh ephemeral container attached
 * to the constrained egress network, docker-execs the command, and stops the
 * container in finally. No warm pool.
 *
 * ⚠ Egress is UNFILTERED (shares clawix-python-net-egress with python_run_net,
 * which has no RFC1918/metadata SSRF block). See
 * docs/plans/2026-07-15-shell-net-and-egress-status.md §3.
 */
import { randomUUID } from 'node:crypto';

import { createLogger } from '@clawix/shared';
import type { AgentDefinition } from '@clawix/shared';

import type { IContainerRunner } from '../container-runner.js';
import type { Tool, ToolExecuteContext, ToolResult } from '../tool.js';
import { checkDenyPatterns } from './shell.js';

const logger = createLogger('engine:tools:shell_net');

const NETWORK_NAME = process.env['PYTHON_NET_NETWORK_NAME'] ?? 'clawix-python-net-egress';
const RUNNER_IMAGE = process.env['SHELL_NET_RUNNER_IMAGE'] ?? 'clawix-shell-net-runner:latest';
/** Operator allowlist re-permitting internal host[:port] targets past the egress block. */
const ALLOWLIST = process.env['SHELL_NET_INTERNAL_ALLOWLIST'] ?? '';
const DEFAULT_WORKDIR = '/workspace';
const MAX_COMMAND_BYTES = 8192;

export interface ShellNetPolicy {
  readonly allowShellNet: boolean;
  readonly maxShellNetMemoryMb: number;
  readonly maxShellNetTimeoutSecs: number;
  readonly maxShellNetCpuCores: number;
  readonly maxConcurrentShellNetRuns: number;
}

export interface ShellNetDeps {
  readonly userId: string;
  readonly workspaceHostPath: string;
  readonly policy: ShellNetPolicy;
  readonly runner: Pick<IContainerRunner, 'start' | 'exec' | 'stop'>;
  readonly limiter: {
    acquire: (userId: string, cap: number) => void;
    release: (userId: string) => void;
  };
}

export interface ShellNetToolResult extends ToolResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export function createShellNetTool(deps: ShellNetDeps): Tool {
  return {
    name: 'shell_net',
    description:
      'Execute a shell command in a fresh ephemeral container WITH outbound network access. ' +
      'USE THIS FOR: curl/wget HTTP calls, git clone/fetch, ssh/scp — anything needing the network. ' +
      "DON'T USE THIS WHEN: no network is needed — prefer the plain `shell` tool. " +
      'Only available when allowShellNet is enabled in the active policy. Slower than `shell` (fresh container per call).',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute.' },
        workdir: {
          type: 'string',
          description: 'Working directory inside the container (default: /workspace).',
        },
        timeoutSecs: {
          type: 'integer',
          minimum: 1,
          description: 'Execution timeout in seconds (capped by policy).',
        },
      },
      required: ['command'],
    },
    requiresApproval: true,
    approvalScope: 'run',

    async execute(
      rawInput: Record<string, unknown>,
      ctx?: ToolExecuteContext,
    ): Promise<ToolResult> {
      const callId = randomUUID();
      const startedAt = Date.now();

      // ── Validate ───────────────────────────────────────────────────
      const command = typeof rawInput['command'] === 'string' ? rawInput['command'] : '';
      if (command.trim().length === 0) {
        return makeErrorResult('Error: command is required.');
      }
      if (Buffer.byteLength(command, 'utf8') > MAX_COMMAND_BYTES) {
        return makeErrorResult(`Error: command exceeds ${MAX_COMMAND_BYTES} bytes.`);
      }

      // ── Policy ─────────────────────────────────────────────────────
      if (!deps.policy.allowShellNet) {
        return makeErrorResult('Error: shell_net is not enabled in the active policy.');
      }

      // ── Deny-pattern hard stop — BEFORE any container work ─────────
      const denyReason = checkDenyPatterns(command);
      if (denyReason !== undefined) {
        logger.warn({ callId, command, denyReason }, 'shell_net command blocked by deny patterns');
        return makeErrorResult(denyReason);
      }

      const workdir =
        typeof rawInput['workdir'] === 'string' ? rawInput['workdir'] : DEFAULT_WORKDIR;
      const timeoutSec = Math.min(
        typeof rawInput['timeoutSecs'] === 'number'
          ? rawInput['timeoutSecs']
          : deps.policy.maxShellNetTimeoutSecs,
        deps.policy.maxShellNetTimeoutSecs,
      );

      // ── Concurrency gate ───────────────────────────────────────────
      try {
        deps.limiter.acquire(deps.userId, deps.policy.maxConcurrentShellNetRuns);
      } catch (err) {
        return makeErrorResult(err);
      }

      let containerId: string | undefined;
      try {
        const syntheticAgentDef: AgentDefinition = {
          id: `shell-net-runner-${callId}`,
          name: `Shell Net Runner (${callId})`,
          description: null,
          systemPrompt: '',
          role: 'worker',
          provider: 'none',
          model: 'none',
          apiBaseUrl: null,
          skillIds: [],
          maxTokensPerRun: 0,
          containerConfig: {
            image: RUNNER_IMAGE,
            cpuLimit: String(deps.policy.maxShellNetCpuCores),
            memoryLimit: `${deps.policy.maxShellNetMemoryMb}m`,
            timeoutSeconds: deps.policy.maxShellNetTimeoutSecs,
            readOnlyRootfs: false,
            allowedMounts: [],
            idleTimeoutSeconds: 0,
          },
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        containerId = await deps.runner.start(syntheticAgentDef, [], {
          disableAutoStop: true,
          workspaceHostPath: deps.workspaceHostPath,
          network: NETWORK_NAME,
          egressFirewall: true,
          egressAllowlist: ALLOWLIST,
        });

        try {
          // The container boots as root for the firewall entrypoint; agent work
          // must run as uid 1000 (the entrypoint's gosu-dropped user).
          const execRes = await deps.runner.exec(containerId, ['sh', '-c', command], {
            signal: ctx?.abortSignal,
            timeout: timeoutSec * 1000,
            workdir,
            user: '1000:1000',
          });

          const stderr = mapExitCodeToStderr(execRes, timeoutSec, deps.policy.maxShellNetMemoryMb);
          const isError = execRes.exitCode !== 0;

          logger.info(
            {
              tool: 'shell_net',
              callId,
              userId: deps.userId,
              exitCode: execRes.exitCode,
              durationMs: Date.now() - startedAt,
              stdoutBytes: execRes.stdout.length,
              stderrBytes: stderr.length,
            },
            'shell_net completed',
          );

          return makeResult({
            stdout: execRes.stdout,
            stderr,
            exitCode: execRes.exitCode,
            isError,
          });
        } finally {
          if (containerId !== undefined) {
            await deps.runner.stop(containerId).catch((err: unknown) => {
              logger.warn({ containerId, err }, 'shell_net: failed to stop ephemeral container');
            });
          }
        }
      } catch (err) {
        return makeErrorResult(err);
      } finally {
        deps.limiter.release(deps.userId);
      }
    },
  };
}

// ------------------------------------------------------------------ //
//  Helpers                                                            //
// ------------------------------------------------------------------ //

function mapExitCodeToStderr(
  res: { exitCode: number; stdout: string; stderr: string },
  timeoutSec: number,
  memMb: number,
): string {
  if (res.exitCode === 124) return `Error: execution timed out after ${timeoutSec}s.`;
  if (res.exitCode === 137)
    return `Error: process killed (out of memory). Memory limit was ${memMb} MB.`;
  if (res.exitCode === -1) return 'Error: cancelled.';
  return res.stderr;
}

function makeResult(r: {
  stdout: string;
  stderr: string;
  exitCode: number;
  isError: boolean;
}): ShellNetToolResult {
  return {
    output: (r.isError ? r.stderr : r.stdout).trim(),
    isError: r.isError,
    stdout: r.stdout,
    stderr: r.stderr,
    exitCode: r.exitCode,
  };
}

function makeErrorResult(err: unknown): ShellNetToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { output: message, isError: true, stdout: '', stderr: message, exitCode: 0 };
}
