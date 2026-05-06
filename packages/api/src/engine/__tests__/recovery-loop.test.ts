import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, LLMProvider, LLMResponse, ChatOptions } from '@clawix/shared';

import { runWithRecovery } from '../recovery-loop.js';
import { classifyError } from '../error-classifier.js';
import { DEFAULT_RECOVERY_CONFIG } from '../recovery-loop.types.js';
import type { RecoveryEvent, RecoveryConfig } from '../recovery-loop.types.js';

const ZERO_BACKOFF: RecoveryConfig = {
  ...DEFAULT_RECOVERY_CONFIG,
  retryBackoffMs: [0, 0, 0],
};

interface ScriptedProvider {
  name: string;
  chat: ReturnType<typeof vi.fn>;
}

function provider(script: { throw?: Error; return?: LLMResponse }[]): ScriptedProvider {
  let i = 0;
  return {
    name: 'mock',
    chat: vi.fn().mockImplementation(async () => {
      const step = script[i++];
      if (!step) throw new Error('script exhausted');
      if (step.throw) throw step.throw;
      return step.return!;
    }),
  };
}

const ok: LLMResponse = { content: 'hi', toolCalls: [], usage: {} } as unknown as LLMResponse;

const baseMessages: ChatMessage[] = [{ role: 'user', content: 'hello' } as ChatMessage];

describe('runWithRecovery', () => {
  it('returns on success without invoking recovery', async () => {
    const events: RecoveryEvent[] = [];
    const p = provider([{ return: ok }]);
    const result = await runWithRecovery(
      p as unknown as LLMProvider,
      baseMessages,
      {} as ChatOptions,
      {
        classifier: classifyError,
        compressor: vi.fn(),
        onRecoveryEvent: (e) => events.push(e),
      },
      ZERO_BACKOFF,
    );
    expect(result.response).toBe(ok);
    expect(events).toHaveLength(0);
  });

  it('retries a transient error and succeeds', async () => {
    const events: RecoveryEvent[] = [];
    const p = provider([
      { throw: Object.assign(new Error('status 503 overloaded'), { status: 503 }) },
      { return: ok },
    ]);
    const result = await runWithRecovery(
      p as unknown as LLMProvider,
      baseMessages,
      {} as ChatOptions,
      {
        classifier: classifyError,
        compressor: vi.fn(),
        onRecoveryEvent: (e) => events.push(e),
      },
      ZERO_BACKOFF,
    );
    expect(result.response).toBe(ok);
    expect(p.chat).toHaveBeenCalledTimes(2);
    expect(events.map((e) => e.type)).toEqual(['recovery_action', 'recovery_succeeded']);
    expect(events[0]!.action).toBe('retry');
  });

  it('exhausts retries and surfaces the last error', async () => {
    const err = Object.assign(new Error('status 503 overloaded'), { status: 503 });
    const p = provider([{ throw: err }, { throw: err }, { throw: err }, { throw: err }]);
    const events: RecoveryEvent[] = [];
    await expect(
      runWithRecovery(
        p as unknown as LLMProvider,
        baseMessages,
        {} as ChatOptions,
        {
          classifier: classifyError,
          compressor: vi.fn(),
          onRecoveryEvent: (e) => events.push(e),
        },
        ZERO_BACKOFF,
      ),
    ).rejects.toBe(err);
    expect(p.chat).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    expect(events.filter((e) => e.type === 'recovery_action')).toHaveLength(3);
    expect(events.find((e) => e.type === 'recovery_exhausted')!.reason).toBe('no_action');
  });

  it('compresses and retries on context_overflow', async () => {
    const overflow = new Error('400 — context_length_exceeded');
    const p = provider([{ throw: overflow }, { return: ok }]);
    const compressed: ChatMessage[] = [{ role: 'system', content: 'compressed' } as ChatMessage];
    const compressor = vi.fn().mockResolvedValue(compressed);
    const events: RecoveryEvent[] = [];
    const result = await runWithRecovery(
      p as unknown as LLMProvider,
      baseMessages,
      {} as ChatOptions,
      {
        classifier: classifyError,
        compressor,
        onRecoveryEvent: (e) => events.push(e),
      },
      ZERO_BACKOFF,
    );
    expect(result.response).toBe(ok);
    expect(result.messages).toBe(compressed);
    expect(compressor).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.action)).toContain('compress');
  });

  it('surfaces the original error when compressor itself throws', async () => {
    const overflow = new Error('400 — context_length_exceeded');
    const compressor = vi.fn().mockRejectedValue(new Error('summarizer 500'));
    const p = provider([{ throw: overflow }]);
    const events: RecoveryEvent[] = [];
    await expect(
      runWithRecovery(
        p as unknown as LLMProvider,
        baseMessages,
        {} as ChatOptions,
        {
          classifier: classifyError,
          compressor,
          onRecoveryEvent: (e) => events.push(e),
        },
        ZERO_BACKOFF,
      ),
    ).rejects.toBe(overflow);
    expect(events.find((e) => e.type === 'recovery_exhausted')!.reason).toBe('compress_failed');
  });

  it('honors abortSignal and skips recovery', async () => {
    const ac = new AbortController();
    const p: ScriptedProvider = {
      name: 'mock',
      chat: vi.fn().mockImplementation(async () => {
        ac.abort();
        throw new Error('status 503 overloaded');
      }),
    };
    await expect(
      runWithRecovery(
        p as unknown as LLMProvider,
        baseMessages,
        { abortSignal: ac.signal } as ChatOptions,
        {
          classifier: classifyError,
          compressor: vi.fn(),
        },
        ZERO_BACKOFF,
      ),
    ).rejects.toThrow('status 503');
    expect(p.chat).toHaveBeenCalledTimes(1); // no retry attempted
  });

  it('aborts during retry backoff and surfaces the original error', async () => {
    const ac = new AbortController();
    const p = provider([
      { throw: Object.assign(new Error('status 503'), { status: 503 }) },
      // Second call would succeed but should never be reached.
      { return: ok },
    ]);
    // Use a config with a real (non-zero) backoff so the abort can fire mid-sleep.
    const slowBackoff: RecoveryConfig = {
      ...DEFAULT_RECOVERY_CONFIG,
      retryBackoffMs: [200, 200, 200],
    };
    const events: RecoveryEvent[] = [];
    // Schedule abort 50ms in — well before backoff completes.
    setTimeout(() => ac.abort(), 50);
    await expect(
      runWithRecovery(
        p as unknown as LLMProvider,
        baseMessages,
        { abortSignal: ac.signal } as ChatOptions,
        {
          classifier: classifyError,
          compressor: vi.fn(),
          onRecoveryEvent: (e) => events.push(e),
        },
        slowBackoff,
      ),
    ).rejects.toThrow('status 503');
    expect(p.chat).toHaveBeenCalledTimes(1); // only the first call ran
    // Recovery action was emitted (we did start the retry path), but no second chat call.
    expect(events.filter((e) => e.type === 'recovery_action')).toHaveLength(1);
  });

  it('respects globalCap as a safety net', async () => {
    const tight: RecoveryConfig = { ...ZERO_BACKOFF, globalCap: 2, maxRetries: 5 };
    const err = Object.assign(new Error('status 503'), { status: 503 });
    const p = provider([{ throw: err }, { throw: err }, { throw: err }]);
    const events: RecoveryEvent[] = [];
    await expect(
      runWithRecovery(
        p as unknown as LLMProvider,
        baseMessages,
        {} as ChatOptions,
        {
          classifier: classifyError,
          compressor: vi.fn(),
          onRecoveryEvent: (e) => events.push(e),
        },
        tight,
      ),
    ).rejects.toBe(err);
    const exhausted = events.find((e) => e.type === 'recovery_exhausted')!;
    expect(exhausted.reason).toBe('global_cap');
  });
});
