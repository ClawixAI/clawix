import { describe, expect, it } from 'vitest';
import { classifyError, LoopAbortedError } from '../error-classifier.js';

function err(message: string, extra: Record<string, unknown> = {}): Error {
  const e = new Error(message);
  Object.assign(e, extra);
  return e;
}

describe('classifyError', () => {
  describe('provider transient', () => {
    it('classifies ECONNREFUSED as network', () => {
      const r = classifyError(err('fetch failed', { code: 'ECONNREFUSED' }));
      expect(r.category).toBe('network');
      expect(r.flags.retryable).toBe(true);
    });
    it('classifies undici body-timeout as network', () => {
      const r = classifyError(err('UND_ERR_BODY_TIMEOUT'));
      expect(r.category).toBe('network');
    });
    it('classifies "504 deadline exceeded" as timeout', () => {
      const r = classifyError(err('status 504 deadline exceeded'));
      expect(r.category).toBe('timeout');
      expect(r.flags.retryable).toBe(true);
    });
    it('classifies "503 overloaded" as overloaded', () => {
      const r = classifyError(err('status 503 overloaded_error'));
      expect(r.category).toBe('overloaded');
      expect(r.flags.retryable).toBe(true);
    });
    it('classifies "500 internal server error" as server_error', () => {
      const r = classifyError(err('500 Internal Server Error'));
      expect(r.category).toBe('server_error');
      expect(r.flags.retryable).toBe(true);
    });
    it('classifies 429 as rate_limit', () => {
      const r = classifyError(err('status 429 too many requests'));
      expect(r.category).toBe('rate_limit');
      expect(r.flags.retryable).toBe(true);
    });
  });

  describe('provider permanent (recovery deferred)', () => {
    it('classifies 401 as auth with rotatable flag', () => {
      const r = classifyError(err('status 401 unauthorized'));
      expect(r.category).toBe('auth');
      expect(r.flags.retryable).toBe(false);
      expect(r.flags.rotatable).toBe(true);
    });
    it('classifies 402 / "credit balance" as billing', () => {
      const r = classifyError(err('402 — your credit balance is too low'));
      expect(r.category).toBe('billing');
      expect(r.flags.rotatable).toBe(true);
    });
    it('classifies "model_deprecated" as model_not_found', () => {
      const r = classifyError(err('the model has been model_deprecated'));
      expect(r.category).toBe('model_not_found');
      expect(r.flags.fallbackable).toBe(true);
    });
    it('classifies "violates our content policy" as provider_policy', () => {
      const r = classifyError(err('this request violates our content policy'));
      expect(r.category).toBe('provider_policy');
      expect(r.flags.fallbackable).toBe(true);
    });
  });

  describe('provider permanent (no recovery)', () => {
    it('classifies "context_length_exceeded" as context_overflow', () => {
      const r = classifyError(err('400 — context_length_exceeded: 250000 > 200000'));
      expect(r.category).toBe('context_overflow');
      expect(r.flags.compressible).toBe(true);
    });
    it('classifies 413 as payload_too_large', () => {
      const r = classifyError(err('status 413 request too large'));
      expect(r.category).toBe('payload_too_large');
      expect(r.flags.retryable).toBe(false);
      expect(r.flags.compressible).toBe(false);
    });
    it('classifies 400 (catch-all) as bad_request', () => {
      const r = classifyError(err('status 400 invalid argument'));
      expect(r.category).toBe('bad_request');
    });
  });

  describe('non-provider', () => {
    it('classifies "is not allowed by policy" as policy', () => {
      const r = classifyError(err('action is not allowed by policy'));
      expect(r.category).toBe('policy');
    });
    it('classifies LoopAbortedError as loop_aborted', () => {
      const r = classifyError(new LoopAbortedError('web_search', { q: 'x' }));
      expect(r.category).toBe('loop_aborted');
    });
    it('classifies a random Error as unknown', () => {
      const r = classifyError(err('unexpected internal failure'));
      expect(r.category).toBe('unknown');
    });
  });

  describe('ordering', () => {
    it('keeps auth ahead of network even when message contains "connection"', () => {
      const r = classifyError(err('status 401 — connection rejected by gateway'));
      expect(r.category).toBe('auth');
    });
    it('keeps context_overflow ahead of bad_request for 400 responses', () => {
      const r = classifyError(err('400 — context_length_exceeded'));
      expect(r.category).toBe('context_overflow');
    });
    it('keeps provider_policy ahead of bad_request', () => {
      const r = classifyError(err('400 — content_filter triggered'));
      expect(r.category).toBe('provider_policy');
    });
  });

  describe('error-shape extraction', () => {
    it('reads .cause one level deep', () => {
      const inner = err('ECONNRESET', { code: 'ECONNRESET' });
      const outer = err('fetch failed', { cause: inner });
      const r = classifyError(outer);
      expect(r.category).toBe('network');
    });
    it('falls back gracefully on non-Error throws', () => {
      const r = classifyError('plain string error');
      expect(r.category).toBe('unknown');
    });
    it('attaches the original error as .cause', () => {
      const e = err('boom');
      const r = classifyError(e);
      expect(r.cause).toBe(e);
    });
  });

  describe('user-safe text', () => {
    it('never includes the raw message verbatim', () => {
      const sensitive = err('status 401 — Bearer abc123secret');
      const r = classifyError(sensitive);
      expect(r.text).not.toContain('abc123secret');
    });
    it('every category produces non-empty text', () => {
      const samples: Record<string, Error> = {
        network: err('ECONNRESET', { code: 'ECONNRESET' }),
        timeout: err('504 deadline'),
        overloaded: err('503 overloaded'),
        server_error: err('500 internal'),
        rate_limit: err('429'),
        auth: err('401'),
        billing: err('402 credit balance'),
        model_not_found: err('model_deprecated'),
        provider_policy: err('content policy violation'),
        context_overflow: err('context_length_exceeded'),
        payload_too_large: err('413 request too large'),
        bad_request: err('400 invalid'),
        policy: err('not allowed by policy'),
        unknown: err('boom'),
      };
      for (const e of Object.values(samples)) {
        const r = classifyError(e);
        expect(r.text.length).toBeGreaterThan(0);
      }
    });
  });
});
