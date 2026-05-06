/**
 * Classifies thrown values from the agent runner into categories with
 * recovery flags and a user-safe display string.
 *
 * Provider-agnostic: matches on patterns from Anthropic / OpenAI / Gemini /
 * generic OpenAI-compat normalized messages plus undici fetch-cause codes.
 *
 * `LoopAbortedError` is defined here (not in tool-loop-guard) because the
 * classifier needs to recognize it via instanceof and tool-loop-guard
 * imports the symbol from here — avoids a circular import.
 */

import type { ClassifiedError, ErrorCategory, RecoveryFlags } from './recovery-loop.types.js';

/* ----------------------------- LoopAbortedError ----------------------------- */

export class LoopAbortedError extends Error {
  readonly toolName: string;
  readonly args: unknown;
  constructor(toolName: string, args: unknown) {
    super(`Tool ${toolName} failed repeatedly with identical args; aborting`);
    this.name = 'LoopAbortedError';
    this.toolName = toolName;
    this.args = args;
  }
}

/* ----------------------------- Flag tables ----------------------------- */

const NO_FLAGS: RecoveryFlags = {
  retryable: false,
  compressible: false,
  rotatable: false,
  fallbackable: false,
};

const FLAGS_BY_CATEGORY: Record<ErrorCategory, RecoveryFlags> = {
  network: { ...NO_FLAGS, retryable: true },
  timeout: { ...NO_FLAGS, retryable: true },
  overloaded: { ...NO_FLAGS, retryable: true },
  server_error: { ...NO_FLAGS, retryable: true },
  rate_limit: { ...NO_FLAGS, retryable: true },
  auth: { ...NO_FLAGS, rotatable: true },
  billing: { ...NO_FLAGS, rotatable: true },
  model_not_found: { ...NO_FLAGS, fallbackable: true },
  provider_policy: { ...NO_FLAGS, fallbackable: true },
  context_overflow: { ...NO_FLAGS, compressible: true },
  payload_too_large: NO_FLAGS,
  bad_request: NO_FLAGS,
  policy: NO_FLAGS,
  loop_aborted: NO_FLAGS,
  unknown: NO_FLAGS,
};

const USER_MESSAGES: Record<ErrorCategory, string> = {
  network: "I can't reach the AI provider right now. Please try again in a moment.",
  timeout: "I can't reach the AI provider right now. Please try again in a moment.",
  overloaded: 'The AI provider is busy right now. Please try again shortly.',
  server_error: 'The AI provider hit an internal error. Please try again shortly.',
  rate_limit: "We've hit a rate limit. Please wait a minute and try again.",
  auth: 'The AI provider rejected our credentials. An admin needs to check the API key.',
  billing: "The AI provider's account is out of credits. An admin needs to top up the account.",
  model_not_found: 'The configured AI model is unavailable. Please contact your administrator.',
  provider_policy:
    'Your message was flagged as potentially unsafe by the AI provider. Try rephrasing your request.',
  context_overflow:
    'This conversation has grown too long for the AI to process. Please start a new chat or simplify your request.',
  payload_too_large:
    'An attached file or image is too large for the AI provider. Please upload a smaller file.',
  bad_request: "I couldn't process that — the provider rejected the request shape.",
  policy:
    "This request isn't allowed by your account's plan or has exceeded its budget. Please contact your administrator.",
  loop_aborted:
    'I got stuck retrying the same step. Please rephrase your request or try a different approach.',
  unknown: 'Something went wrong while processing your message. Please try again.',
};

/* ----------------------------- Pattern tables ----------------------------- */

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const NETWORK_PATTERNS = ['fetch failed', 'network error', 'socket hang up', 'und_err_'];

const TIMEOUT_PATTERNS = [
  'status 504',
  '504 ',
  'deadline exceeded',
  'request timed out',
  'request timeout',
];

const OVERLOADED_PATTERNS = [
  'status 503',
  '503 ',
  'status 529',
  '529 ',
  'overloaded',
  'service unavailable',
];

const SERVER_ERROR_PATTERNS = ['status 500', '500 ', 'status 502', '502 ', 'internal server error'];

const RATE_LIMIT_PATTERNS = [
  'rate limit',
  'rate_limit',
  'quota exceeded',
  'status 429',
  '429 ',
  'too many requests',
];

const AUTH_PATTERNS = [
  'auth failed',
  'unauthorized',
  'api_key_invalid',
  'invalid api key',
  'status 401',
  '401 ',
];

const BILLING_PATTERNS = [
  'status 402',
  '402 ',
  'credit balance',
  'insufficient_quota',
  'insufficient quota',
  'out of credits',
];

const MODEL_NOT_FOUND_PATTERNS = ['model not found', 'model_deprecated', 'model_not_found'];

const PROVIDER_POLICY_PATTERNS = [
  'unsafe or sensitive content',
  'safety system',
  'content policy',
  'content_policy',
  'content_filter',
  'flagged as inappropriate',
  'violates our usage policy',
  'violates our content policy',
];

const CONTEXT_OVERFLOW_PATTERNS = [
  'context length',
  'maximum context',
  'context_length_exceeded',
  'context window',
  'too many tokens',
];

const PAYLOAD_TOO_LARGE_PATTERNS = ['status 413', '413 ', 'request too large', 'payload too large'];

const BAD_REQUEST_PATTERNS = [
  'request rejected',
  'invalid argument',
  'status 400',
  '400 ',
  'bad request',
];

const POLICY_PATTERNS = ['is not allowed by policy', 'token budget exceeded', 'is inactive'];

/* ----------------------------- Helpers ----------------------------- */

interface ErrorShape {
  readonly message: string;
  readonly code?: string;
  readonly status?: number;
}

function extractErrorShape(err: unknown): ErrorShape {
  if (!(err instanceof Error)) {
    return { message: typeof err === 'string' ? err : '' };
  }
  let message = err.message ?? '';
  const direct = err as { code?: unknown; status?: unknown; cause?: unknown };
  let code: string | undefined = typeof direct.code === 'string' ? direct.code : undefined;
  const status: number | undefined = typeof direct.status === 'number' ? direct.status : undefined;
  if (direct.cause instanceof Error) {
    const cause = direct.cause as { code?: unknown; message?: string };
    if (!code && typeof cause.code === 'string') code = cause.code;
    if (cause.message) message = `${message} ${cause.message}`;
  }
  return { message, code, status };
}

function matchesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

function build(category: ErrorCategory, cause: unknown): ClassifiedError {
  return {
    category,
    text: USER_MESSAGES[category],
    flags: FLAGS_BY_CATEGORY[category],
    cause,
  };
}

/* ----------------------------- Public entry ----------------------------- */

/**
 * Classify any thrown value into a category, flag set, and user-safe text.
 *
 * Order of checks matters — see spec §3.3. Specific patterns (auth, content
 * filter, context-overflow) are tested before broader ones (bad_request,
 * network) because some provider messages overlap (e.g. a 401 message that
 * mentions "connection").
 */
export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof LoopAbortedError) {
    return build('loop_aborted', err);
  }

  const shape = extractErrorShape(err);
  const lower = shape.message.toLowerCase();
  const code = shape.code;

  if (matchesAny(lower, POLICY_PATTERNS)) return build('policy', err);
  if (matchesAny(lower, CONTEXT_OVERFLOW_PATTERNS)) return build('context_overflow', err);
  if (matchesAny(lower, PAYLOAD_TOO_LARGE_PATTERNS) || shape.status === 413) {
    return build('payload_too_large', err);
  }
  if (matchesAny(lower, PROVIDER_POLICY_PATTERNS)) return build('provider_policy', err);
  if (matchesAny(lower, MODEL_NOT_FOUND_PATTERNS)) return build('model_not_found', err);
  if (matchesAny(lower, AUTH_PATTERNS) || shape.status === 401) return build('auth', err);
  if (matchesAny(lower, BILLING_PATTERNS) || shape.status === 402) return build('billing', err);
  if (matchesAny(lower, RATE_LIMIT_PATTERNS) || shape.status === 429) {
    return build('rate_limit', err);
  }
  if (matchesAny(lower, OVERLOADED_PATTERNS) || shape.status === 503 || shape.status === 529) {
    return build('overloaded', err);
  }
  if (matchesAny(lower, SERVER_ERROR_PATTERNS) || shape.status === 500 || shape.status === 502) {
    return build('server_error', err);
  }
  if (matchesAny(lower, TIMEOUT_PATTERNS) || shape.status === 504) return build('timeout', err);
  if ((code && NETWORK_CODES.has(code)) || matchesAny(lower, NETWORK_PATTERNS)) {
    return build('network', err);
  }
  if (matchesAny(lower, BAD_REQUEST_PATTERNS) || shape.status === 400) {
    return build('bad_request', err);
  }
  return build('unknown', err);
}

/* ----------------------------- Re-exports ----------------------------- */

export { USER_MESSAGES };
