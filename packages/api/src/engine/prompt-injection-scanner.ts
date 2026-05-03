import { createLogger } from '@clawix/shared';

const logger = createLogger('engine:prompt-injection-scanner');

interface ThreatPattern {
  readonly id: string;
  readonly pattern: RegExp;
}

const THREAT_PATTERNS: readonly ThreatPattern[] = [
  { id: 'prompt_injection', pattern: /ignore\s+(previous|all|above|prior)\s+instructions/i },
  { id: 'deception_hide', pattern: /do\s+not\s+tell\s+the\s+user/i },
  { id: 'sys_prompt_override', pattern: /system\s+prompt\s+override/i },
  {
    id: 'disregard_rules',
    pattern: /disregard\s+(your|all|any)\s+(instructions|rules|guidelines)/i,
  },
  {
    id: 'bypass_restrictions',
    pattern:
      /act\s+as\s+(if|though)\s+you\s+(have\s+no|don't\s+have)\s+(restrictions|limits|rules)/i,
  },
  {
    id: 'html_comment_injection',
    pattern: /<!--[^>]*(?:ignore|override|system|secret|hidden)[^>]*-->/i,
  },
  { id: 'hidden_div', pattern: /<\s*div\s+style\s*=\s*["'][\s\S]*?display\s*:\s*none/i },
  { id: 'translate_execute', pattern: /translate\s+.*\s+into\s+.*\s+and\s+(execute|run|eval)/i },
  {
    id: 'exfil_curl',
    pattern: /curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i,
  },
  { id: 'read_secrets', pattern: /cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass)/i },
];

const INVISIBLE_CHARS: readonly string[] = ['​', '‌', '‍', '⁠', '﻿', '‪', '‫', '‬', '‭', '‮'];

export interface ScanResult {
  readonly sanitized: string;
  readonly blocked: boolean;
  readonly findings: readonly string[];
}

/**
 * Scan a context-file's content for prompt-injection patterns before it is
 * concatenated into a system prompt.
 *
 * Returns the original content when clean, or a `[BLOCKED: …]` marker when any
 * threat pattern or invisible-unicode character is found. Always returns a
 * usable string so callers can keep the section framing intact.
 */
export function scanContextContent(content: string, filename: string): ScanResult {
  const findings: string[] = [];

  for (const ch of INVISIBLE_CHARS) {
    if (content.includes(ch)) {
      const code = ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
      findings.push(`invisible unicode U+${code}`);
    }
  }

  for (const { id, pattern } of THREAT_PATTERNS) {
    if (pattern.test(content)) {
      findings.push(id);
    }
  }

  if (findings.length === 0) {
    return { sanitized: content, blocked: false, findings: [] };
  }

  logger.warn({ filename, findings }, 'Context file blocked: prompt injection detected');

  const sanitized = `[BLOCKED: ${filename} contained potential prompt injection (${findings.join(', ')}). Content not loaded.]`;
  return { sanitized, blocked: true, findings };
}
