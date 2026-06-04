import { describe, expect, it } from 'vitest';

import {
  estimateCost,
  findProviderByModel,
  findProviderByName,
  getProviderSpec,
  listProviders,
} from '../provider-registry.js';

describe('findProviderByName', () => {
  it('should find the anthropic provider', () => {
    const spec = findProviderByName('anthropic');

    expect(spec).toEqual(expect.objectContaining({ name: 'anthropic', displayName: 'Anthropic' }));
  });

  it('should find the openai provider', () => {
    const spec = findProviderByName('openai');

    expect(spec).toEqual(expect.objectContaining({ name: 'openai', displayName: 'OpenAI' }));
  });

  it('should find the custom provider', () => {
    const spec = findProviderByName('custom');

    expect(spec).toEqual(expect.objectContaining({ name: 'custom' }));
  });

  it('should return null for an unknown provider', () => {
    const spec = findProviderByName('nonexistent');

    expect(spec).toBeNull();
  });
});

describe('findProviderByModel', () => {
  it('should detect anthropic from claude- prefix', () => {
    const spec = findProviderByModel('claude-sonnet-4-20250514');

    expect(spec).toEqual(expect.objectContaining({ name: 'anthropic' }));
  });

  it('should detect anthropic from claude-opus model', () => {
    const spec = findProviderByModel('claude-opus-4-20250514');

    expect(spec).toEqual(expect.objectContaining({ name: 'anthropic' }));
  });

  it('should detect openai from gpt- prefix', () => {
    const spec = findProviderByModel('gpt-4o');

    expect(spec).toEqual(expect.objectContaining({ name: 'openai' }));
  });

  it('should detect openai from gpt-4o-mini', () => {
    const spec = findProviderByModel('gpt-4o-mini');

    expect(spec).toEqual(expect.objectContaining({ name: 'openai' }));
  });

  it('should detect openai from o1- prefix', () => {
    const spec = findProviderByModel('o1-preview');

    expect(spec).toEqual(expect.objectContaining({ name: 'openai' }));
  });

  it('should detect openai from o3- prefix', () => {
    const spec = findProviderByModel('o3-mini');

    expect(spec).toEqual(expect.objectContaining({ name: 'openai' }));
  });

  it('should detect openai from o4- prefix', () => {
    const spec = findProviderByModel('o4-mini');

    expect(spec).toEqual(expect.objectContaining({ name: 'openai' }));
  });

  it('should return null for an unknown model', () => {
    const spec = findProviderByModel('llama-3-70b');

    expect(spec).toBeNull();
  });
});

describe('getProviderSpec', () => {
  it('should return the spec for a known provider', () => {
    const spec = getProviderSpec('anthropic');

    expect(spec.name).toBe('anthropic');
    expect(spec.supportsTools).toBe(true);
    expect(spec.supportsThinking).toBe(true);
  });

  it('should throw for an unknown provider', () => {
    expect(() => getProviderSpec('nonexistent')).toThrow();
  });

  it('should throw with a descriptive message', () => {
    expect(() => getProviderSpec('nonexistent')).toThrow(/provider.*nonexistent.*not found/i);
  });
});

describe('listProviders', () => {
  it('should return at least 3 providers', () => {
    const providers = listProviders();

    expect(providers.length).toBeGreaterThanOrEqual(3);
  });

  it('should include anthropic, openai, and custom', () => {
    const providers = listProviders();
    const names = providers.map((p) => p.name);

    expect(names).toContain('anthropic');
    expect(names).toContain('openai');
    expect(names).toContain('custom');
  });

  it('should return a new array on each call (immutability)', () => {
    const a = listProviders();
    const b = listProviders();

    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('provider-registry (zai-coding + defaultBaseUrl)', () => {
  it('finds zai-coding provider by name', () => {
    const spec = findProviderByName('zai-coding');
    expect(spec).not.toBeNull();
    expect(spec!.name).toBe('zai-coding');
    expect(spec!.displayName).toBe('Z.AI Coding Plan');
    expect(spec!.defaultBaseUrl).toBe('https://api.z.ai/api/coding/paas/v4');
    expect(spec!.supportsTools).toBe(true);
  });

  it('detects zai-coding provider from glm- model prefix', () => {
    const spec = findProviderByModel('glm-4.7');
    expect(spec).not.toBeNull();
    expect(spec!.name).toBe('zai-coding');
  });

  it('detects zai-coding for glm-5.1 model', () => {
    const spec = findProviderByModel('glm-5.1');
    expect(spec).not.toBeNull();
    expect(spec!.name).toBe('zai-coding');
  });

  it('anthropic spec has no defaultBaseUrl (uses SDK default)', () => {
    const spec = getProviderSpec('anthropic');
    expect(spec.defaultBaseUrl).toBeUndefined();
  });

  it('listProviders includes zai-coding', () => {
    const providers = listProviders();
    const names = providers.map((p) => p.name);
    expect(names).toContain('zai-coding');
  });

  it('finds anthropic by claude- prefix', () => {
    expect(findProviderByModel('claude-sonnet-4-20250514')?.name).toBe('anthropic');
  });

  it('finds openai by gpt- prefix', () => {
    expect(findProviderByModel('gpt-4o')?.name).toBe('openai');
  });
});

describe('Gemini provider spec', () => {
  it('is registered by name', () => {
    const spec = findProviderByName('gemini');
    expect(spec).not.toBeNull();
    expect(spec?.displayName).toBe('Google Gemini');
    expect(spec?.envKey).toBe('GEMINI_API_KEY');
    expect(spec?.defaultModel).toBe('gemini-3-flash-preview');
    expect(spec?.supportsTools).toBe(true);
  });

  it('matches gemini- model prefix for both 2.5 and 3.x families', () => {
    expect(findProviderByModel('gemini-2.5-pro')?.name).toBe('gemini');
    expect(findProviderByModel('gemini-2.5-flash')?.name).toBe('gemini');
    expect(findProviderByModel('gemini-2.5-flash-lite')?.name).toBe('gemini');
    expect(findProviderByModel('gemini-3-pro-preview')?.name).toBe('gemini');
    expect(findProviderByModel('gemini-3-flash-preview')?.name).toBe('gemini');
    expect(findProviderByModel('gemini-3.1-pro-preview')?.name).toBe('gemini');
  });

  it('estimates cost for gemini-2.5-pro', () => {
    const cost = estimateCost('gemini', 'gemini-2.5-pro', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(1.25 + 10.0);
  });

  it('estimates cost for gemini-2.5-flash', () => {
    const cost = estimateCost('gemini', 'gemini-2.5-flash', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.3 + 2.5);
  });

  it('estimates cost for gemini-2.5-flash-lite', () => {
    const cost = estimateCost('gemini', 'gemini-2.5-flash-lite', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.1 + 0.4);
  });

  it('estimates cost for gemini-3-pro-preview (placeholder pricing — verify before GA)', () => {
    const cost = estimateCost('gemini', 'gemini-3-pro-preview', 1_000_000, 1_000_000);
    expect(cost).not.toBeNull();
  });

  it('estimates cost for gemini-3-flash-preview (placeholder pricing — verify before GA)', () => {
    const cost = estimateCost('gemini', 'gemini-3-flash-preview', 1_000_000, 1_000_000);
    expect(cost).not.toBeNull();
  });

  it('matches versioned model variants via longest-prefix match', () => {
    const cost = estimateCost('gemini', 'gemini-2.5-pro-preview-06-05', 1_000_000, 0);
    expect(cost).toBeCloseTo(1.25);
  });

  it('appears in listProviders()', () => {
    expect(listProviders().some((p) => p.name === 'gemini')).toBe(true);
  });
});

describe('Kimi Code provider spec', () => {
  it('is registered by name', () => {
    const spec = findProviderByName('kimi-code');
    expect(spec).not.toBeNull();
    expect(spec?.displayName).toBe('Kimi Coding Plan');
    expect(spec?.envKey).toBe('KIMI_CODE_API_KEY');
    expect(spec?.defaultBaseUrl).toBe('https://api.kimi.com/coding');
    expect(spec?.supportsTools).toBe(true);
    expect(spec?.supportsThinking).toBe(false);
    expect(spec?.pricing).toBeNull();
  });

  it('appears in listProviders()', () => {
    expect(listProviders().some((p) => p.name === 'kimi-code')).toBe(true);
  });
});

describe('DeepSeek provider spec', () => {
  it('is registered by name', () => {
    const spec = findProviderByName('deepseek');
    expect(spec).not.toBeNull();
    expect(spec?.displayName).toBe('DeepSeek');
    expect(spec?.envKey).toBe('DEEPSEEK_API_KEY');
    expect(spec?.defaultBaseUrl).toBe('https://api.deepseek.com');
    expect(spec?.defaultModel).toBe('deepseek-v4-flash');
    expect(spec?.supportsTools).toBe(true);
    expect(spec?.supportsThinking).toBe(false);
  });

  it('detects deepseek from the deepseek- model prefix', () => {
    expect(findProviderByModel('deepseek-v4-flash')?.name).toBe('deepseek');
    expect(findProviderByModel('deepseek-v4-pro')?.name).toBe('deepseek');
  });

  it('appears in listProviders()', () => {
    expect(listProviders().some((p) => p.name === 'deepseek')).toBe(true);
  });

  it('estimates cost for deepseek-v4-flash', () => {
    const cost = estimateCost('deepseek', 'deepseek-v4-flash', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.14 + 0.28, 5);
  });

  it('estimates cost for deepseek-v4-pro', () => {
    const cost = estimateCost('deepseek', 'deepseek-v4-pro', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.435 + 0.87, 5);
  });

  it('returns null cost for a legacy/unknown deepseek model (no pricing entry)', () => {
    expect(estimateCost('deepseek', 'deepseek-chat', 1_000, 1_000)).toBeNull();
  });
});

describe('estimateCost', () => {
  it('should calculate cost for claude-opus-4', () => {
    // $15 per M input, $75 per M output
    const cost = estimateCost('anthropic', 'claude-opus-4', 1_000_000, 1_000_000);

    expect(cost).toBeCloseTo(15 + 75, 2);
  });

  it('should calculate cost for claude-sonnet-4', () => {
    // $3 per M input, $15 per M output
    const cost = estimateCost('anthropic', 'claude-sonnet-4', 1_000_000, 1_000_000);

    expect(cost).toBeCloseTo(3 + 15, 2);
  });

  it('should calculate cost for claude-haiku-4', () => {
    // $0.80 per M input, $4 per M output
    const cost = estimateCost('anthropic', 'claude-haiku-4', 1_000_000, 1_000_000);

    expect(cost).toBeCloseTo(0.8 + 4, 2);
  });

  it('should calculate cost for gpt-4o', () => {
    // $2.5 per M input, $10 per M output
    const cost = estimateCost('openai', 'gpt-4o', 1_000_000, 1_000_000);

    expect(cost).toBeCloseTo(2.5 + 10, 2);
  });

  it('should calculate cost for gpt-4o-mini', () => {
    // $0.15 per M input, $0.6 per M output
    const cost = estimateCost('openai', 'gpt-4o-mini', 1_000_000, 1_000_000);

    expect(cost).toBeCloseTo(0.15 + 0.6, 2);
  });

  it('should calculate cost for o3-mini', () => {
    // $1.1 per M input, $4.4 per M output
    const cost = estimateCost('openai', 'o3-mini', 1_000_000, 1_000_000);

    expect(cost).toBeCloseTo(1.1 + 4.4, 2);
  });

  it('should scale correctly for small token counts', () => {
    // 1000 input tokens of claude-sonnet-4: $3 / 1000 = $0.003
    const cost = estimateCost('anthropic', 'claude-sonnet-4', 1_000, 0);

    expect(cost).toBeCloseTo(0.003, 6);
  });

  it('should return null for custom provider', () => {
    const cost = estimateCost('custom', 'my-model', 1_000, 1_000);

    expect(cost).toBeNull();
  });

  it('should return null for unknown model in known provider', () => {
    const cost = estimateCost('anthropic', 'claude-unknown-99', 1_000, 1_000);

    expect(cost).toBeNull();
  });

  it('should return null for unknown provider', () => {
    const cost = estimateCost('nonexistent', 'some-model', 1_000, 1_000);

    expect(cost).toBeNull();
  });
});

describe('estimateCost — cache pricing', () => {
  it('charges cache write tokens at 1.25× the input rate', () => {
    // sonnet-4 input: $3 / MTok → cache write: $3.75 / MTok
    const cost = estimateCost('anthropic', 'claude-sonnet-4-20250514', 0, 0, {
      cacheCreationTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(3.75, 5);
  });

  it('charges cache read tokens at 0.1× the input rate', () => {
    // sonnet-4 input: $3 / MTok → cache read: $0.30 / MTok
    const cost = estimateCost('anthropic', 'claude-sonnet-4-20250514', 0, 0, {
      cacheReadTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.3, 5);
  });

  it('combines regular, cache write, and cache read input pricing', () => {
    // 1M regular + 1M write + 1M read = 3 + 3.75 + 0.30 = 7.05
    const cost = estimateCost('anthropic', 'claude-sonnet-4-20250514', 1_000_000, 0, {
      cacheCreationTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(7.05, 5);
  });

  it('treats undefined cache token counts as zero', () => {
    // Same as the existing "no options" path
    const withoutOptions = estimateCost('anthropic', 'claude-sonnet-4-20250514', 1000, 1000);
    const withEmptyOptions = estimateCost('anthropic', 'claude-sonnet-4-20250514', 1000, 1000, {});
    expect(withEmptyOptions).toBe(withoutOptions);
  });

  it('returns null when pricing is unavailable, even with cache tokens', () => {
    const cost = estimateCost('zai-coding', 'glm-4.7', 100, 100, {
      cacheCreationTokens: 100,
      cacheReadTokens: 100,
    });
    expect(cost).toBeNull();
  });
});
