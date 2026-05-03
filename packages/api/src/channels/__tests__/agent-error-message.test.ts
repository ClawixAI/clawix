import { describe, it, expect } from 'vitest';

import { classifyAgentError } from '../agent-error-message.js';

describe('classifyAgentError', () => {
  describe('network category', () => {
    it('classifies undici connect-timeout errors', () => {
      const err = new Error(
        'Gemini network error: fetch failed (UND_ERR_CONNECT_TIMEOUT): Connect Timeout Error',
      );
      const result = classifyAgentError(err);
      expect(result.category).toBe('network');
      expect(result.text).toMatch(/can't reach the AI provider/i);
    });

    it('classifies bare "fetch failed" via cause.code', () => {
      const cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      const err = Object.assign(new TypeError('fetch failed'), { cause });
      const result = classifyAgentError(err);
      expect(result.category).toBe('network');
    });

    it('classifies ENOTFOUND DNS failures', () => {
      const err = new Error('getaddrinfo ENOTFOUND api.example.com');
      const result = classifyAgentError(err);
      expect(result.category).toBe('network');
    });

    it('classifies generic ETIMEDOUT', () => {
      const err = new Error('Connection ETIMEDOUT');
      const result = classifyAgentError(err);
      expect(result.category).toBe('network');
    });
  });

  describe('auth category', () => {
    it('classifies "Gemini auth failed"', () => {
      const err = new Error('Gemini auth failed: API_KEY_INVALID');
      const result = classifyAgentError(err);
      expect(result.category).toBe('auth');
      expect(result.text).toMatch(/admin/i);
    });

    it('classifies generic 401 messages', () => {
      const err = new Error('Request failed with status 401 Unauthorized');
      const result = classifyAgentError(err);
      expect(result.category).toBe('auth');
    });
  });

  describe('rate_limit category', () => {
    it('classifies Gemini rate limit', () => {
      const err = new Error('Gemini rate limit: Quota exceeded');
      const result = classifyAgentError(err);
      expect(result.category).toBe('rate_limit');
      expect(result.text).toMatch(/rate limit|wait/i);
    });

    it('classifies generic 429 messages', () => {
      const err = new Error('429 Too Many Requests');
      const result = classifyAgentError(err);
      expect(result.category).toBe('rate_limit');
    });
  });

  describe('bad_request category', () => {
    it('classifies provider request rejections', () => {
      const err = new Error('Gemini request rejected: Invalid argument');
      const result = classifyAgentError(err);
      expect(result.category).toBe('bad_request');
      expect(result.text).toMatch(/couldn't process|rejected/i);
    });
  });

  describe('policy category', () => {
    it('classifies provider-not-allowed errors thrown by agent-runner', () => {
      const err = new Error("Provider 'openai' is not allowed by policy 'standard'");
      const result = classifyAgentError(err);
      expect(result.category).toBe('policy');
      expect(result.text).toMatch(/policy|administrator|plan/i);
    });

    it('classifies token-budget-exceeded errors', () => {
      const err = new Error("Token budget exceeded for user 'u1': $1.0000 used of $0.5000 budget");
      const result = classifyAgentError(err);
      expect(result.category).toBe('policy');
      expect(result.text).toMatch(/budget|limit|administrator/i);
    });

    it('classifies inactive agent definition errors', () => {
      const err = new Error("Agent definition 'abc' is inactive");
      const result = classifyAgentError(err);
      expect(result.category).toBe('policy');
    });
  });

  describe('content_filter category', () => {
    it('classifies Moonshot/Kimi safety rejection as content_filter', () => {
      const err = new Error(
        '400 System detected potentially unsafe or sensitive content in input or generation.',
      );
      const result = classifyAgentError(err);
      expect(result.category).toBe('content_filter');
      expect(result.text).toMatch(/flagged|unsafe|rephrase/i);
    });

    it('classifies OpenAI content-policy rejection as content_filter', () => {
      const err = new Error('Your request was rejected as a result of our content policy.');
      const result = classifyAgentError(err);
      expect(result.category).toBe('content_filter');
    });

    it('classifies Anthropic safety-system rejection as content_filter', () => {
      const err = new Error('Output blocked by safety system');
      const result = classifyAgentError(err);
      expect(result.category).toBe('content_filter');
    });
  });

  describe('unknown category', () => {
    it('falls back for unrecognized errors', () => {
      const err = new Error('something completely unexpected');
      const result = classifyAgentError(err);
      expect(result.category).toBe('unknown');
      expect(result.text).toMatch(/something went wrong/i);
    });

    it('handles non-Error throws gracefully', () => {
      const result = classifyAgentError('boom');
      expect(result.category).toBe('unknown');
    });

    it('handles undefined gracefully', () => {
      const result = classifyAgentError(undefined);
      expect(result.category).toBe('unknown');
    });
  });

  it('never includes stack traces or internal paths in the user text', () => {
    const err = new Error('boom\n    at foo (/app/dist/internal.js:123:45)');
    const result = classifyAgentError(err);
    expect(result.text).not.toMatch(/\/app\/|at foo|\.js:/);
  });
});
