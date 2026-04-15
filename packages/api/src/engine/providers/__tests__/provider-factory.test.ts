import { describe, it, expect, vi } from 'vitest';

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
  })),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn() },
  })),
}));

vi.mock('@clawix/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clawix/shared')>();
  return {
    ...actual,
    createLogger: vi.fn().mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

import { createProvider } from '../provider-factory.js';
import { OpenAIProvider } from '../openai-provider.js';
import { AnthropicProvider } from '../anthropic-provider.js';
import { OpenAIResponsesProvider } from '../openai-responses-provider.js';

describe('createProvider', () => {
  const API_KEY = 'test-api-key';

  it('creates an AnthropicProvider for "anthropic"', () => {
    const provider = createProvider('anthropic', API_KEY);
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.name).toBe('anthropic');
  });

  it('creates an OpenAIProvider for "openai"', () => {
    const provider = createProvider('openai', API_KEY);
    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider.name).toBe('openai');
  });

  it('passes baseURL to OpenAIProvider when provided', () => {
    const provider = createProvider('openai', API_KEY, 'https://custom.openai.com/v1');
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it('creates an OpenAIProvider for "zai-coding" with default base URL', () => {
    const provider = createProvider('zai-coding', API_KEY);
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it('uses custom baseURL for zai-coding when provided', () => {
    const provider = createProvider('zai-coding', API_KEY, 'https://custom.z.ai/v1');
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it('creates an OpenAIProvider for unknown provider with baseURL (custom)', () => {
    const provider = createProvider('my-custom-llm', API_KEY, 'https://my-llm.example.com');
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it('throws for unknown provider without baseURL', () => {
    expect(() => createProvider('my-custom-llm', API_KEY)).toThrow(
      'baseURL is required for provider "my-custom-llm"',
    );
  });

  it('returns OpenAIResponsesProvider for codex models', () => {
    const provider = createProvider('openai', API_KEY, undefined, 'gpt-5.1-codex-mini');
    expect(provider).toBeInstanceOf(OpenAIResponsesProvider);
    expect(provider.name).toBe('openai-responses');
  });

  it('returns OpenAIProvider for standard openai models', () => {
    const provider = createProvider('openai', API_KEY, undefined, 'gpt-4.1');
    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider.name).toBe('openai');
  });

  it('returns OpenAIProvider when no model specified', () => {
    const provider = createProvider('openai', API_KEY);
    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider.name).toBe('openai');
  });

  it('returns OpenAIResponsesProvider for gpt-5.x models', () => {
    const provider = createProvider('openai', API_KEY, undefined, 'gpt-5.4');
    expect(provider).toBeInstanceOf(OpenAIResponsesProvider);
    expect(provider.name).toBe('openai-responses');
  });
});
