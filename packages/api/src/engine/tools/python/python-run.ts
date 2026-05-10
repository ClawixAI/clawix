/**
 * python_run tool factory — sandboxed Python execution with no outbound network.
 *
 * Composes:
 *   - Input validation (validatePythonInput)
 *   - Policy enforcement (enforcePythonPolicy)
 *   - Concurrency limiter (PythonConcurrencyLimiter interface)
 *   - Install mutex (InstallMutex interface)
 *   - Container pool (acquire/release)
 *   - Proxy health gate (isHealthy)
 *
 * Errors are returned as a structured result (isError: true) rather than
 * thrown, consistent with the ToolRegistry error-suffix mechanism.
 */
import { randomUUID } from 'node:crypto';

import { createLogger } from '@clawix/shared';

import type { Tool, ToolExecuteContext, ToolResult } from '../../tool.js';
import { validatePythonInput } from './input-validation.js';
import { enforcePythonPolicy } from './policy-enforcement.js';
import { parseFindOutput } from './files-changed.js';
import { PythonToolError } from './types.js';
import type { PythonRunInput, PythonRunResult, PythonToolPolicy } from './types.js';
import {
  classifyExit,
  pythonPackagesInstalledTotal,
  pythonRunDurationSeconds,
  pythonRunTotal,
} from './python-metrics.js';

const logger = createLogger('engine:tools:python_run');

// ------------------------------------------------------------------ //
//  Deps interface                                                     //
// ------------------------------------------------------------------ //

export interface PythonRunDeps {
  readonly sessionId: string;
  readonly userId: string;
  readonly workspaceHostPath: string;
  readonly policy: PythonToolPolicy;
  readonly pool: {
    acquire: (
      sessionId: string,
      opts: { workspaceHostPath: string; memoryMb?: number; cpus?: number },
    ) => Promise<string>;
    release: (sessionId: string) => void;
  };
  readonly runner: {
    exec: (
      containerId: string,
      cmd: readonly string[],
      opts?: {
        signal?: AbortSignal;
        timeout?: number;
        workdir?: string;
        stdin?: string;
      },
    ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  };
  readonly proxyHealth: { isHealthy: () => boolean };
  readonly limiter: {
    acquire: (userId: string, cap: number) => void;
    release: (userId: string) => void;
  };
  readonly installMutex: {
    runExclusive: <T>(containerId: string, fn: () => Promise<T>) => Promise<T>;
  };
}

// ------------------------------------------------------------------ //
//  Result type — superset of ToolResult                               //
// ------------------------------------------------------------------ //

/** Extended result that carries structured python output alongside ToolResult fields. */
export interface PythonToolResult extends ToolResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly filesChanged: string[];
}

// ------------------------------------------------------------------ //
//  Factory                                                            //
// ------------------------------------------------------------------ //

export function createPythonRunTool(deps: PythonRunDeps): Tool {
  return {
    name: 'python_run',
    description:
      'Execute Python code or a Python script file in a sandboxed container with /workspace mounted. ' +
      'No outbound network. Pre-installed: pandas, requests, numpy, httpx, beautifulsoup4, python-dateutil. ' +
      'Additional packages may be requested via `packages` (subject to allowlist).\n\n' +
      'USE THIS FOR: CSV/JSON/parquet data analysis, math/scientific computation, multi-step ' +
      'file transformations, anything beyond a one-liner.\n\n' +
      "DON'T USE THIS FOR: simple shell ops like ls, cp, mv, cat, grep, sed, awk, find, jq — " +
      'use `shell` instead.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Inline Python source. Mutually exclusive with `script`.',
        },
        script: {
          type: 'string',
          description: 'Path to a .py file under /workspace. Mutually exclusive with `code`.',
        },
        packages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional extra packages to install before running (subject to allowlist).',
        },
        timeoutSecs: {
          type: 'integer',
          minimum: 1,
          description: 'Execution timeout in seconds (capped by policy).',
        },
      },
    },

    async execute(
      rawInput: Record<string, unknown>,
      ctx?: ToolExecuteContext,
    ): Promise<ToolResult> {
      const input = rawInput as PythonRunInput;
      const callId = randomUUID();
      const startedAt = Date.now();

      // ── Validation + policy + concurrency gate ─────────────────────
      try {
        validatePythonInput(input);
        enforcePythonPolicy(input, deps.policy);
        deps.limiter.acquire(deps.userId, deps.policy.maxConcurrentPythonRuns);
      } catch (err) {
        return makeErrorResult(err);
      }

      // ── Main execution (limiter.release in finally) ────────────────
      try {
        // Proxy gate: packages requested but proxy down
        if (input.packages && input.packages.length > 0 && !deps.proxyHealth.isHealthy()) {
          throw new PythonToolError(
            'PROXY_UNAVAILABLE',
            "Error: PyPI proxy unavailable. Pre-baked packages still work; remove 'packages' to retry.",
          );
        }

        const containerId = await deps.pool.acquire(deps.sessionId, {
          workspaceHostPath: deps.workspaceHostPath,
          memoryMb: deps.policy.maxPythonMemoryMb,
          cpus: deps.policy.maxPythonCpuCores,
        });

        try {
          const markerPath = `/tmp/python_run_marker_${callId}`;
          await deps.runner.exec(containerId, ['touch', markerPath], { signal: ctx?.abortSignal });

          // Install extra packages if requested
          if (input.packages && input.packages.length > 0) {
            await deps.installMutex.runExclusive(containerId, async () => {
              const installRes = await deps.runner.exec(
                containerId,
                ['pip', 'install', '--quiet', '--no-color', ...input.packages!],
                { signal: ctx?.abortSignal, timeout: 120 * 1000 },
              );
              if (installRes.exitCode !== 0) {
                throw new PythonToolError(
                  'INSTALL_FAILED',
                  `Error: pip install failed: ${installRes.stderr.slice(0, 1000)}`,
                );
              }
            });
          }

          // Write inline code to a temp script or use the provided script path
          let scriptPath: string;
          if (input.code !== undefined) {
            scriptPath = await writeInlineScript(
              deps,
              containerId,
              callId,
              input.code,
              ctx?.abortSignal,
            );
          } else {
            // Verify the script exists inside the container and does not escape /workspace
            const checkRes = await deps.runner.exec(
              containerId,
              [
                'sh',
                '-c',
                `if [ -e "$0" ]; then readlink -f "$0"; else echo NOTFOUND; fi`,
                input.script!,
              ],
              { signal: ctx?.abortSignal, timeout: 5_000 },
            );
            const resolved = checkRes.stdout.trim();
            if (resolved === 'NOTFOUND' || !resolved.startsWith('/workspace/')) {
              throw new PythonToolError(
                'SCRIPT_NOT_FOUND',
                `Error: script not found at '${input.script}', or path escapes /workspace.`,
              );
            }
            scriptPath = resolved;
          }

          const timeoutSec = Math.min(
            input.timeoutSecs ?? deps.policy.maxPythonTimeoutSecs,
            deps.policy.maxPythonTimeoutSecs,
          );

          const execRes = await deps.runner.exec(containerId, ['python', scriptPath], {
            signal: ctx?.abortSignal,
            timeout: timeoutSec * 1000,
            workdir: '/workspace',
          });

          // Collect workspace files modified during this run
          const filesChanged = ctx?.abortSignal?.aborted
            ? []
            : parseFindOutput(
                (
                  await deps.runner.exec(containerId, [
                    'find',
                    '/workspace',
                    '-newer',
                    markerPath,
                    '-type',
                    'f',
                    '-printf',
                    '%P\n',
                  ])
                ).stdout,
              );

          const stderr = mapExitCodeToStderr(execRes, timeoutSec, deps.policy.maxPythonMemoryMb);
          const isError = execRes.exitCode !== 0;

          const durationMs = Date.now() - startedAt;

          logger.info(
            {
              tool: 'python_run',
              callId,
              userId: deps.userId,
              sessionId: deps.sessionId,
              inputMode: input.code !== undefined ? 'code' : 'script',
              packages: input.packages ?? [],
              exitCode: execRes.exitCode,
              durationMs,
              stdoutBytes: execRes.stdout.length,
              stderrBytes: stderr.length,
              filesChangedCount: filesChanged.length,
            },
            'python_run completed',
          );

          pythonRunTotal.inc({ tool: 'python_run', exit_code: classifyExit(execRes.exitCode) });
          pythonRunDurationSeconds.observe({ tool: 'python_run' }, durationMs / 1000);
          for (const pkg of input.packages ?? []) {
            pythonPackagesInstalledTotal.inc({ package: pkg.split('==')[0] });
          }

          return makePythonResult({
            stdout: execRes.stdout,
            stderr,
            exitCode: execRes.exitCode,
            isError,
            filesChanged,
          });
        } finally {
          deps.pool.release(deps.sessionId);
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

async function writeInlineScript(
  deps: PythonRunDeps,
  containerId: string,
  callId: string,
  code: string,
  signal?: AbortSignal,
): Promise<string> {
  const path = `/tmp/python_run_script_${callId}.py`;
  // Pipe through `cat >` so no shell escaping touches the source code.
  await deps.runner.exec(containerId, ['sh', '-c', `cat > ${path}`], {
    signal,
    stdin: code,
  });
  return path;
}

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

function makePythonResult(r: PythonRunResult): PythonToolResult {
  // `output` mirrors stderr when isError, otherwise stdout — gives the
  // ToolRegistry's error-suffix a single string to append to.
  const base = r.isError ? r.stderr : r.stdout;
  const outputParts = [base.trim()];
  if (r.filesChanged.length > 0) {
    outputParts.push(`\n[Files written to /workspace: ${r.filesChanged.join(', ')}]`);
  }
  const output = outputParts.filter((p) => p.length > 0).join('');
  return {
    output,
    isError: r.isError,
    stdout: r.stdout,
    stderr: r.stderr,
    exitCode: r.exitCode,
    filesChanged: r.filesChanged,
  };
}

function makeErrorResult(err: unknown): PythonToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    output: message,
    isError: true,
    stdout: '',
    stderr: message,
    exitCode: 0,
    filesChanged: [],
  };
}
