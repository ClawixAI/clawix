/**
 * Shell tool — executes shell commands inside a container via `docker exec`.
 *
 * Security: all commands are checked against a deny-list of dangerous patterns
 * before execution. Compound commands and subshells are also inspected.
 */
import { createLogger } from '@clawix/shared';

import type { IContainerRunner } from '../container-runner.js';
import type { Tool, ToolExecuteContext, ToolResult } from '../tool.js';

const logger = createLogger('engine:tools:shell');

// ------------------------------------------------------------------ //
//  Deny patterns                                                      //
// ------------------------------------------------------------------ //

interface DenyPattern {
  readonly regex: RegExp;
  readonly reason: string;
}

const DENY_PATTERNS: readonly DenyPattern[] = [
  { regex: /\brm\s+-[rf]{1,2}\s+\//, reason: 'rm -rf / is destructive' },
  { regex: /\brm\s+-[rf]{1,2}\s+\*/, reason: 'rm -rf * is destructive' },
  { regex: /\b(mkfs|diskpart)\b/, reason: 'disk formatting is not allowed' },
  { regex: /\bdd\s+if=/, reason: 'raw disk write is not allowed' },
  { regex: />\s*\/dev\/sd/, reason: 'writing to disk device is not allowed' },
  {
    regex: /\b(shutdown|reboot|poweroff|halt|init\s+0)\b/,
    reason: 'system power commands are not allowed',
  },
  { regex: /\bsudo\b/, reason: 'privilege escalation via sudo is not allowed' },
  { regex: /\bsu\s+-/, reason: 'switching users is not allowed' },
  { regex: /\bchmod\s+777\b/, reason: 'world-writable permissions are not allowed' },
  { regex: /\bchown\s+root\b/, reason: 'changing ownership to root is not allowed' },
  { regex: /\bcurl\s+.*\|\s*sh\b/, reason: 'curl pipe to shell is not allowed' },
  { regex: /\bwget\s+.*\|\s*sh\b/, reason: 'wget pipe to shell is not allowed' },
  { regex: /:\(\)\s*\{.*\};\s*:/, reason: 'fork bomb detected' },
  { regex: /\bpython\s+-c\s+.*fork/, reason: 'python fork bomb detected' },
  { regex: /\bperl\s+-e\s+.*fork/, reason: 'perl fork bomb detected' },
];

/**
 * Split compound commands into individual segments for deny-pattern checking.
 * Handles `;`, `&&`, `||`, and `|` operators.
 */
function splitCompoundCommand(command: string): readonly string[] {
  return command.split(/\s*;\s*|\s*&&\s*|\s*\|\|\s*|\s*\|\s*/).filter((seg) => seg.length > 0);
}

/**
 * Extract inner commands from subshell expressions (backticks and `$(...)`).
 */
function extractSubshells(command: string): readonly string[] {
  const results: string[] = [];

  // Match backtick subshells: `...`
  const backtickRegex = /`([^`]*)`/g;
  let match: RegExpExecArray | null;
  while ((match = backtickRegex.exec(command)) !== null) {
    const inner = match[1];
    if (inner !== undefined && inner.length > 0) {
      results.push(inner);
    }
  }

  // Match $(...) subshells — handle simple (non-nested) cases
  const dollarParenRegex = /\$\(([^)]*)\)/g;
  while ((match = dollarParenRegex.exec(command)) !== null) {
    const inner = match[1];
    if (inner !== undefined && inner.length > 0) {
      results.push(inner);
    }
  }

  return results;
}

/**
 * Check a single command segment against all deny patterns.
 * @returns A denial reason string if blocked, or `undefined` if safe.
 */
function checkSegment(segment: string): string | undefined {
  const lower = segment.toLowerCase();
  for (const { regex, reason } of DENY_PATTERNS) {
    if (regex.test(lower)) {
      return reason;
    }
  }
  return undefined;
}

/**
 * Check a full command (including compound operators and subshells) against deny patterns.
 *
 * @param command - The raw shell command string.
 * @returns A denial message if blocked, or `undefined` if safe.
 */
export function checkDenyPatterns(command: string): string | undefined {
  // Check the full command first
  const fullCheck = checkSegment(command);
  if (fullCheck !== undefined) {
    return `Command blocked: ${fullCheck}`;
  }

  // Check each compound segment
  for (const segment of splitCompoundCommand(command)) {
    const segCheck = checkSegment(segment);
    if (segCheck !== undefined) {
      return `Command blocked: ${segCheck}`;
    }
  }

  // Check subshell contents
  for (const subshell of extractSubshells(command)) {
    const subCheck = checkSegment(subshell);
    if (subCheck !== undefined) {
      return `Command blocked: ${subCheck} (in subshell)`;
    }

    // Also check compound commands within subshells
    for (const segment of splitCompoundCommand(subshell)) {
      const segCheck = checkSegment(segment);
      if (segCheck !== undefined) {
        return `Command blocked: ${segCheck} (in subshell)`;
      }
    }
  }

  return undefined;
}

// ------------------------------------------------------------------ //
//  Shell tool factory                                                 //
// ------------------------------------------------------------------ //

const DEFAULT_WORKDIR = '/workspace';
const DEFAULT_TIMEOUT_SECONDS = 60;

/**
 * Create a shell tool bound to a specific container.
 *
 * @param containerId - The Docker container ID to execute commands in.
 * @param containerRunner - The container runner to use for exec calls.
 */
export function createShellTool(containerId: string, containerRunner: IContainerRunner): Tool {
  return {
    name: 'shell',
    description: 'Execute a shell command inside the agent container.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute.',
        },
        workdir: {
          type: 'string',
          description: 'Working directory inside the container (default: /workspace).',
        },
        timeout: {
          type: 'integer',
          description: 'Timeout in seconds (1–600, default: 60).',
          minimum: 1,
          maximum: 600,
        },
      },
      required: ['command'],
    },

    async execute(params: Record<string, unknown>, ctx?: ToolExecuteContext): Promise<ToolResult> {
      const command = params['command'] as string;
      const workdir = typeof params['workdir'] === 'string' ? params['workdir'] : DEFAULT_WORKDIR;
      const timeoutSec =
        typeof params['timeout'] === 'number' ? params['timeout'] : DEFAULT_TIMEOUT_SECONDS;

      logger.debug({ containerId, command, workdir, timeoutSec }, 'Executing shell command');

      // Security check
      const denyReason = checkDenyPatterns(command);
      if (denyReason !== undefined) {
        logger.warn({ containerId, command, denyReason }, 'Shell command blocked by deny patterns');
        return { output: denyReason, isError: true };
      }

      const result = await containerRunner.exec(containerId, ['sh', '-c', command], {
        workdir,
        timeout: timeoutSec * 1000,
        ...(ctx?.abortSignal ? { signal: ctx.abortSignal } : {}),
      });

      if (result.exitCode !== 0) {
        const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
        const errorOutput = `${combined}\n\nExit code: ${result.exitCode}`;
        logger.debug({ containerId, exitCode: result.exitCode }, 'Shell command exited non-zero');
        return { output: errorOutput, isError: true };
      }

      return { output: result.stdout, isError: false };
    },
  };
}
