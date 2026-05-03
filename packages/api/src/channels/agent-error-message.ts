/**
 * Maps agent-execution errors to user-facing categories + safe display text.
 *
 * Provider-agnostic: matches on patterns from any provider's normalized error
 * message (anthropic, openai, gemini, …) plus undici fetch-cause `code`s.
 *
 * Returned `text` never contains stack traces, file paths, or raw provider
 * internals — safe to send directly to end users on any channel.
 */

export type AgentErrorCategory =
  | 'network'
  | 'auth'
  | 'rate_limit'
  | 'bad_request'
  | 'content_filter'
  | 'policy'
  | 'unknown';

export interface ClassifiedAgentError {
  readonly category: AgentErrorCategory;
  readonly text: string;
}

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

const NETWORK_PATTERNS = [
  'fetch failed',
  'network error',
  'connect timeout',
  'socket hang up',
  'etimedout',
  'econnreset',
  'econnrefused',
  'enotfound',
  'und_err_',
];

const AUTH_PATTERNS = [
  'auth failed',
  'unauthorized',
  'api_key_invalid',
  'invalid api key',
  'status 401',
  '401 ',
];

const RATE_LIMIT_PATTERNS = [
  'rate limit',
  'rate_limit',
  'quota exceeded',
  'status 429',
  '429 ',
  'too many requests',
];

const BAD_REQUEST_PATTERNS = [
  'request rejected',
  'invalid argument',
  'status 400',
  '400 bad request',
];

const POLICY_PATTERNS = ['is not allowed by policy', 'token budget exceeded', 'is inactive'];

const CONTENT_FILTER_PATTERNS = [
  'unsafe or sensitive content',
  'potentially unsafe',
  'safety system',
  'content policy',
  'content_policy',
  'content_filter',
  'flagged as inappropriate',
  'violates our usage policy',
  'violates our content policy',
];

const MESSAGES: Record<AgentErrorCategory, string> = {
  network: "I can't reach the AI provider right now. Please try again in a moment.",
  auth: 'The AI provider rejected our credentials. An admin needs to check the API key.',
  rate_limit: "We've hit a rate limit. Please wait a minute and try again.",
  bad_request: "I couldn't process that — the provider rejected the request shape.",
  content_filter:
    'Your message was flagged as potentially unsafe by the AI provider. Try rephrasing your request.',
  policy:
    "This request isn't allowed by your account's plan or has exceeded its budget. Please contact your administrator.",
  unknown: 'Something went wrong while processing your message. Please try again.',
};

function extractCode(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined;
  const direct = (err as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === 'string') return causeCode;
  }
  return undefined;
}

function matchesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/**
 * Classify any thrown value into a category and a user-safe display string.
 *
 * Order matters: auth/rate_limit/bad_request are checked before the broader
 * network match, since some provider messages contain "connection" wording
 * even when the real cause was a 401/429/400.
 */
export function classifyAgentError(err: unknown): ClassifiedAgentError {
  const message = err instanceof Error ? err.message : '';
  const lower = message.toLowerCase();
  const code = extractCode(err);

  if (matchesAny(lower, POLICY_PATTERNS)) {
    return { category: 'policy', text: MESSAGES.policy };
  }
  if (matchesAny(lower, CONTENT_FILTER_PATTERNS)) {
    return { category: 'content_filter', text: MESSAGES.content_filter };
  }
  if (matchesAny(lower, AUTH_PATTERNS)) {
    return { category: 'auth', text: MESSAGES.auth };
  }
  if (matchesAny(lower, RATE_LIMIT_PATTERNS)) {
    return { category: 'rate_limit', text: MESSAGES.rate_limit };
  }
  if (matchesAny(lower, BAD_REQUEST_PATTERNS)) {
    return { category: 'bad_request', text: MESSAGES.bad_request };
  }
  if ((code && NETWORK_CODES.has(code)) || matchesAny(lower, NETWORK_PATTERNS)) {
    return { category: 'network', text: MESSAGES.network };
  }
  return { category: 'unknown', text: MESSAGES.unknown };
}
