import { describe, expect, it } from 'vitest';

import { supportsVisionModel, visionFamily } from './vision-gateway.js';

describe('visionFamily', () => {
  it('routes Anthropic-shaped providers (anthropic, kimi-code) to the Anthropic family', () => {
    expect(visionFamily('anthropic')).toBe('anthropic');
    expect(visionFamily('kimi-code')).toBe('anthropic');
  });

  it('routes OpenAI-shaped providers (openai, zai-coding) to the OpenAI family', () => {
    expect(visionFamily('openai')).toBe('openai');
    expect(visionFamily('zai-coding')).toBe('openai');
  });

  it('routes gemini to its own family', () => {
    expect(visionFamily('gemini')).toBe('gemini');
  });

  it('falls back to OpenAI for unknown / custom-baseURL providers', () => {
    // Mirrors the engine's provider-factory.ts: unknown providers are
    // assumed OpenAI-compatible and require a baseURL.
    expect(visionFamily('my-custom-provider')).toBe('openai');
    expect(visionFamily('some-internal-llm')).toBe('openai');
  });
});

describe('supportsVisionModel', () => {
  it('classifies modern Anthropic Claude models as vision-capable', () => {
    expect(supportsVisionModel('anthropic', 'claude-3-5-sonnet-20241022')).toBe(true);
    expect(supportsVisionModel('anthropic', 'claude-sonnet-4-20250514')).toBe(true);
    expect(supportsVisionModel('anthropic', 'claude-opus-4-20250101')).toBe(true);
    expect(supportsVisionModel('anthropic', 'claude-haiku-4-5-20251001')).toBe(true);
  });

  it('classifies modern OpenAI models as vision-capable', () => {
    expect(supportsVisionModel('openai', 'gpt-4o')).toBe(true);
    expect(supportsVisionModel('openai', 'gpt-4o-mini')).toBe(true);
    expect(supportsVisionModel('openai', 'gpt-4.1')).toBe(true);
    expect(supportsVisionModel('openai', 'gpt-5')).toBe(true);
    expect(supportsVisionModel('openai', 'o3-mini')).toBe(true);
  });

  it('classifies modern Gemini models as vision-capable', () => {
    expect(supportsVisionModel('gemini', 'gemini-2.5-pro')).toBe(true);
    expect(supportsVisionModel('gemini', 'gemini-2.0-flash')).toBe(true);
    expect(supportsVisionModel('gemini', 'gemini-1.5-pro')).toBe(true);
  });

  it('returns false for non-canonical providers regardless of model', () => {
    // Non-canonical providers (kimi-code, zai-coding, BYO endpoints) use their
    // own model naming. Operators must set modelOverrides.browser_vision so the
    // tool trusts the override instead of running the substring check.
    expect(supportsVisionModel('zai-coding', 'glm-4.5v')).toBe(false);
    expect(supportsVisionModel('kimi-code', 'moonshot-v1-vision-preview')).toBe(false);
    expect(supportsVisionModel('custom-llm', 'gpt-4o')).toBe(false);
  });

  it('rejects unrecognized model names within a canonical provider', () => {
    expect(supportsVisionModel('openai', 'gpt-3.5-turbo')).toBe(false);
    expect(supportsVisionModel('anthropic', 'claude-2')).toBe(false);
    expect(supportsVisionModel('gemini', 'palm-2')).toBe(false);
  });
});
