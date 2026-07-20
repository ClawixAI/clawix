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
//  Sensitive-command classification (approval gating)                 //
// ------------------------------------------------------------------ //

/**
 * Kinds of shell command that require human approval.
 *
 * The *category* — not the raw command string — is the approval resource key.
 * Command strings are unbounded free text, so keying approval memory on them
 * would make persistent decisions both useless (never a second hit) and
 * unauditable. Keying on the category means an "Always" grant reads as a
 * capability the user understands: "this agent may install packages".
 */
export type ShellSensitiveCategory = 'net-egress' | 'pkg-install' | 'fs-outside-workspace';

interface SensitivePattern {
  readonly regex: RegExp;
  readonly category: ShellSensitiveCategory;
}

const SENSITIVE_PATTERNS: readonly SensitivePattern[] = [
  // Outbound network
  {
    regex: /\b(curl|wget|nc|netcat|ncat|telnet|ftp|sftp|scp|rsync|ssh)\b/,
    category: 'net-egress',
  },
  { regex: /\bgit\s+(clone|push|pull|fetch|remote|ls-remote)\b/, category: 'net-egress' },
  { regex: /\b(npx|pnpx)\b/, category: 'net-egress' },
  // Package installation
  { regex: /\b(pip|pip3)\s+install\b/, category: 'pkg-install' },
  { regex: /\buv\s+(pip\s+install|add)\b/, category: 'pkg-install' },
  { regex: /\b(npm|pnpm|yarn)\s+(install|add|i)\b/, category: 'pkg-install' },
  { regex: /\bapt(-get)?\s+install\b/, category: 'pkg-install' },
  { regex: /\bapk\s+add\b/, category: 'pkg-install' },
  { regex: /\b(gem|cargo|go)\s+install\b/, category: 'pkg-install' },
  { regex: /\bpoetry\s+add\b/, category: 'pkg-install' },
];

/**
 * Absolute path roots a command may write to without approval. Everything the
 * agent legitimately owns lives under these.
 */
const WRITABLE_ROOTS: readonly string[] = ['/workspace', '/tmp'];

/** Commands whose non-flag arguments name paths they mutate. */
const FS_MUTATING_COMMAND = /^(cp|mv|rm|mkdir|rmdir|touch|chmod|chown|ln|truncate|tee|dd)\b/;

function unquote(token: string): string {
  const first = token[0];
  if ((first === '"' || first === "'") && token.endsWith(first) && token.length > 1) {
    return token.slice(1, -1);
  }
  return token;
}

/**
 * Whether a write target escapes the roots the agent owns.
 *
 * Absolute paths are checked against {@link WRITABLE_ROOTS}. Relative paths
 * resolve against `workdir` (which defaults into /workspace), so they are only
 * treated as escaping when they traverse upward with `..`.
 */
function isOutsideWorkspace(path: string): boolean {
  if (!path.startsWith('/')) {
    return path.split('/').includes('..');
  }
  return !WRITABLE_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

/**
 * Extract the paths a single command segment writes to: redirect targets, plus
 * the non-flag arguments of filesystem-mutating commands.
 */
function writeTargets(segment: string): readonly string[] {
  const targets: string[] = [];

  // Redirects: `> path`, `>> path`, `2> path`. `>&1` style fd-dups are skipped.
  const redirectRegex = /(?:^|\s)\d?>>?\s*(?!&)("[^"]*"|'[^']*'|\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = redirectRegex.exec(segment)) !== null) {
    const target = match[1];
    if (target !== undefined) {
      targets.push(unquote(target));
    }
  }

  const trimmed = segment.trim();
  // `sed` only writes when editing in place; otherwise it is a reader.
  const mutates = FS_MUTATING_COMMAND.test(trimmed) || /^sed\b.*\s-i\b/.test(trimmed);
  if (mutates) {
    for (const token of trimmed.split(/\s+/).slice(1)) {
      if (!token.startsWith('-')) {
        targets.push(unquote(token));
      }
    }
  }

  return targets;
}

/**
 * Classify a command into the approval categories it triggers.
 *
 * This is a heuristic defence-in-depth layer that decides *when to ask a
 * human*, not a security boundary — the container is the boundary, and the
 * deny-pattern list is the hard stop. A sufficiently obfuscated command
 * (base64-decoded payloads, variable indirection) will not be classified;
 * that is accepted, because an unclassified command is still confined to the
 * sandbox and still subject to {@link checkDenyPatterns}.
 *
 * @param command - The raw shell command string.
 * @returns Sorted, de-duplicated categories. Empty means no approval needed.
 */
export function classifyShellCommand(command: string): readonly ShellSensitiveCategory[] {
  const found = new Set<ShellSensitiveCategory>();

  // Word-boundary patterns match anywhere in the command, so subshell and
  // compound contents are covered without decomposing first.
  const lower = command.toLowerCase();
  for (const { regex, category } of SENSITIVE_PATTERNS) {
    if (regex.test(lower)) {
      found.add(category);
    }
  }

  // Write targets need segmentation — a path only means something relative to
  // the command it is an argument of.
  const segments = [
    ...splitCompoundCommand(command),
    ...extractSubshells(command).flatMap((inner) => splitCompoundCommand(inner)),
  ];
  for (const segment of segments) {
    for (const target of writeTargets(segment)) {
      if (isOutsideWorkspace(target)) {
        found.add('fs-outside-workspace');
      }
    }
  }

  return [...found].sort();
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

    // Only commands that reach outside the sandbox are gated — network egress,
    // package installs, and writes escaping the roots the agent owns. Ordinary
    // in-container work (ls, grep, build, test) is exempt via
    // requiresApprovalForParams, which keeps prompt volume survivable and keeps
    // sub-agents (hardcoded auto-deny, never promptable) usable for everything
    // that isn't sensitive. The deny-pattern list remains the hard stop and
    // still runs inside execute() after any approval.
    requiresApproval: true,
    requiresApprovalForParams: (p) => classifyShellCommand(String(p['command'] ?? '')).length > 0,
    approvalScope: 'resource',
    resourceKeyFromParams: (p) => classifyShellCommand(String(p['command'] ?? '')).join('+'),

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
