import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatOptions, LLMProvider, LLMResponse } from '@clawix/shared';
import { ResilientLLMProvider, DEFAULT_RETRY_CONFIG, isTransientError } from '../resilience.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeMockResponse(overrides: Partial<LLMResponse> = {}): LLMResponse {
  return {
    content: 'Hello',
    toolCalls: [],
    finishReason: 'stop',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    thinkingBlocks: null,
    ...overrides,
  };
}

/**
 * Creates an LLMProvider mock that fails `failCount` times with the given
 * error message, then succeeds with the given response.
 */
function makeFlakeyProvider(
  failCount: number,
  errorMessage: string,
  successResponse: LLMResponse = makeMockResponse(),
): LLMProvider {
  let callCount = 0;
  return {
    name: 'mock-flakey',
    chat: vi.fn(async () => {
      callCount += 1;
      if (callCount <= failCount) {
        throw new Error(errorMessage);
      }
      return successResponse;
    }),
  };
}

/** Zero-delay retry config for fast tests. */
const FAST_RETRY_CONFIG = {
  maxRetries: 3,
  backoffMs: [0, 0, 0] as number[],
};

/* ------------------------------------------------------------------ */
/*  ResilientLLMProvider                                               */
/* ------------------------------------------------------------------ */

describe('ResilientLLMProvider', () => {
  const messages: readonly ChatMessage[] = [{ role: 'user', content: 'Hello' }];
  const options: ChatOptions = { model: 'claude-3-5-haiku-20241022' };

  it('delegates name to inner provider', () => {
    const inner: LLMProvider = { name: 'my-provider', chat: vi.fn() };
    const resilient = new ResilientLLMProvider(inner);
    expect(resilient.name).toBe('my-provider');
  });

  it('returns response on success without retry', async () => {
    const response = makeMockResponse({ content: 'Success!' });
    const inner: LLMProvider = { name: 'mock', chat: vi.fn().mockResolvedValue(response) };
    const resilient = new ResilientLLMProvider(inner, FAST_RETRY_CONFIG);

    const result = await resilient.chat(messages, options);

    expect(result).toBe(response);
    expect(inner.chat).toHaveBeenCalledTimes(1);
  });

  it('retries on transient error and succeeds', async () => {
    const response = makeMockResponse({ content: 'Recovered' });
    const inner = makeFlakeyProvider(2, 'status 429 rate limited', response);
    const resilient = new ResilientLLMProvider(inner, FAST_RETRY_CONFIG);

    const result = await resilient.chat(messages, options);

    expect(result).toBe(response);
    // 2 failures + 1 success = 3 calls total
    expect(inner.chat).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting all retries', async () => {
    const inner = makeFlakeyProvider(10, 'status 503 service unavailable');
    const resilient = new ResilientLLMProvider(inner, FAST_RETRY_CONFIG);

    await expect(resilient.chat(messages, options)).rejects.toThrow('status 503');
    // 1 initial attempt + 3 retries = 4 calls
    expect(inner.chat).toHaveBeenCalledTimes(4);
  });

  it('does NOT retry on non-transient error', async () => {
    const inner: LLMProvider = {
      name: 'mock',
      chat: vi.fn().mockRejectedValue(new Error('Invalid API key')),
    };
    const resilient = new ResilientLLMProvider(inner, FAST_RETRY_CONFIG);

    await expect(resilient.chat(messages, options)).rejects.toThrow('Invalid API key');
    // Should not retry — only 1 call
    expect(inner.chat).toHaveBeenCalledTimes(1);
  });

  it('passes messages and options through to inner provider', async () => {
    const response = makeMockResponse();
    const inner: LLMProvider = { name: 'mock', chat: vi.fn().mockResolvedValue(response) };
    const resilient = new ResilientLLMProvider(inner, FAST_RETRY_CONFIG);

    await resilient.chat(messages, options);

    expect(inner.chat).toHaveBeenCalledWith(messages, options);
  });

  it('does not retry when the caller has already aborted the request', async () => {
    // A network-style error message that would normally be retried
    // ("connection") must NOT trigger retries when the abort signal is
    // already set — the failure is intentional cancellation.
    const inner: LLMProvider = {
      name: 'mock',
      chat: vi.fn().mockRejectedValue(new Error('connection reset')),
    };
    const resilient = new ResilientLLMProvider(inner, FAST_RETRY_CONFIG);

    const controller = new AbortController();
    controller.abort();

    await expect(
      resilient.chat(messages, { ...options, abortSignal: controller.signal }),
    ).rejects.toThrow('connection reset');
    expect(inner.chat).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/*  isTransientError                                                   */
/* ------------------------------------------------------------------ */

describe('isTransientError', () => {
  it.each(['status 429 rate limited', 'rate limit exceeded', 'rate_limit_exceeded'])(
    'matches rate-limit pattern: %s',
    (msg) => {
      expect(isTransientError(msg)).toBe(true);
    },
  );

  it.each(['status 500', 'status 502', 'status 503', 'status 504'])(
    'matches server error status: %s',
    (msg) => {
      expect(isTransientError(msg)).toBe(true);
    },
  );

  it.each(['ETIMEDOUT', 'ECONNRESET', 'request timeout'])(
    'matches network/timeout pattern: %s',
    (msg) => {
      expect(isTransientError(msg)).toBe(true);
    },
  );

  it.each(['Invalid API key', '401 unauthorized', '403 forbidden'])(
    'does NOT match non-transient pattern: %s',
    (msg) => {
      expect(isTransientError(msg)).toBe(false);
    },
  );
});

/* ------------------------------------------------------------------ */
/*  DEFAULT_RETRY_CONFIG                                               */
/* ------------------------------------------------------------------ */

describe('DEFAULT_RETRY_CONFIG', () => {
  it('has maxRetries >= 2', () => {
    expect(DEFAULT_RETRY_CONFIG.maxRetries).toBeGreaterThanOrEqual(2);
  });

  it('has backoffMs array with length == maxRetries', () => {
    expect(DEFAULT_RETRY_CONFIG.backoffMs).toHaveLength(DEFAULT_RETRY_CONFIG.maxRetries);
  });

  it('has at least one transient pattern', () => {
    expect(DEFAULT_RETRY_CONFIG.transientPatterns.length).toBeGreaterThan(0);
  });
});
