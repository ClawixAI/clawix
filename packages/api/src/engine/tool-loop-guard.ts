/**
 * ToolLoopGuard — detects pathological tool-call loops where the agent
 * repeatedly invokes the same tool with identical args after each call
 * fails. After 3 consecutive identical failing calls, throws
 * LoopAbortedError to terminate the run cleanly.
 *
 * Resets on any non-matching call (different tool, different args, or
 * a successful call with the same args).
 */

import { LoopAbortedError } from './error-classifier.js';

const TOOL_LOOP_THRESHOLD = 3;

/**
 * Stable JSON serialization with sorted keys so {a:1,b:2} and {b:2,a:1}
 * produce the same canonical string.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function canonicalizeArgs(toolName: string, args: unknown): string {
  return `${toolName}:${stableStringify(args)}`;
}

export class ToolLoopGuard {
  private lastFailingHash: string | null = null;
  private consecutiveFailures = 0;

  /**
   * Record a tool execution result. Throws LoopAbortedError on the 3rd
   * consecutive failing call with identical (toolName, args).
   */
  record(toolName: string, args: unknown, isError: boolean): void {
    const hash = canonicalizeArgs(toolName, args);
    if (isError && hash === this.lastFailingHash) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= TOOL_LOOP_THRESHOLD) {
        throw new LoopAbortedError(toolName, args);
      }
      return;
    }
    if (isError) {
      this.lastFailingHash = hash;
      this.consecutiveFailures = 1;
    } else {
      this.lastFailingHash = null;
      this.consecutiveFailures = 0;
    }
  }
}
