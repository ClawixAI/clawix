/**
 * Provider registry — spec definitions and lookup helpers for LLM providers.
 */

/** Pricing for a specific model (USD per million tokens). */
export interface ModelPricing {
  readonly model: string;
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
}

/** Specification for a supported LLM provider. */
export interface ProviderSpec {
  readonly name: string;
  readonly displayName: string;
  readonly modelPrefixes: readonly string[];
  readonly envKey: string;
  /** Optional base URL override; when absent the SDK's built-in default is used. */
  readonly defaultBaseUrl?: string;
  readonly defaultModel: string;
  readonly supportsTools: boolean;
  readonly supportsThinking: boolean;
  readonly pricing: readonly ModelPricing[] | null;
}

const ANTHROPIC_SPEC: ProviderSpec = {
  name: 'anthropic',
  displayName: 'Anthropic',
  modelPrefixes: ['claude-'],
  envKey: 'ANTHROPIC_API_KEY',
  defaultModel: 'claude-sonnet-4-20250514',
  supportsTools: true,
  supportsThinking: true,
  pricing: [
    // Version-specific models (must come first for longest-prefix matching)
    { model: 'claude-opus-4-6', inputPerMillion: 15, outputPerMillion: 75 },
    { model: 'claude-sonnet-4-6', inputPerMillion: 3, outputPerMillion: 15 },
    { model: 'claude-sonnet-4-5', inputPerMillion: 3, outputPerMillion: 15 },
    { model: 'claude-haiku-4-5', inputPerMillion: 0.8, outputPerMillion: 4 },
    // Base model names (aliases for latest versions)
    { model: 'claude-opus-4', inputPerMillion: 15, outputPerMillion: 75 },
    { model: 'claude-sonnet-4', inputPerMillion: 3, outputPerMillion: 15 },
    { model: 'claude-haiku-4', inputPerMillion: 0.8, outputPerMillion: 4 },
  ],
};

const OPENAI_SPEC: ProviderSpec = {
  name: 'openai',
  displayName: 'OpenAI',
  modelPrefixes: ['gpt-', 'o1-', 'o3-', 'o4-', 'codex-'],
  envKey: 'OPENAI_API_KEY',
  defaultModel: 'gpt-4o',
  supportsTools: true,
  supportsThinking: false,
  pricing: [
    // Chat Completions API compatible models
    { model: 'gpt-4.1', inputPerMillion: 2, outputPerMillion: 8 },
    { model: 'gpt-4.1-mini', inputPerMillion: 0.4, outputPerMillion: 1.6 },
    { model: 'gpt-4.1-nano', inputPerMillion: 0.1, outputPerMillion: 0.4 },
    { model: 'gpt-4o', inputPerMillion: 2.5, outputPerMillion: 10 },
    { model: 'gpt-4o-mini', inputPerMillion: 0.15, outputPerMillion: 0.6 },
    { model: 'o3', inputPerMillion: 10, outputPerMillion: 40 },
    { model: 'o3-mini', inputPerMillion: 1.1, outputPerMillion: 4.4 },
    { model: 'o4-mini', inputPerMillion: 1.1, outputPerMillion: 4.4 },
    // Responses API models (auto-detected by provider factory)
    { model: 'gpt-5-codex', inputPerMillion: 2, outputPerMillion: 8 },
    { model: 'gpt-5.3-codex', inputPerMillion: 2, outputPerMillion: 8 },
    { model: 'gpt-5.2-codex', inputPerMillion: 2, outputPerMillion: 8 },
    { model: 'gpt-5.1-codex', inputPerMillion: 1.5, outputPerMillion: 6 },
    { model: 'gpt-5.1-codex-mini', inputPerMillion: 0.3, outputPerMillion: 1.2 },
    { model: 'gpt-5.4', inputPerMillion: 5, outputPerMillion: 15 },
    { model: 'gpt-5.2', inputPerMillion: 4, outputPerMillion: 14 },
    { model: 'gpt-5.1', inputPerMillion: 3, outputPerMillion: 12 },
  ],
};

const ZAI_CODING_SPEC: ProviderSpec = {
  name: 'zai-coding',
  displayName: 'Z.AI Coding Plan',
  modelPrefixes: ['glm-'],
  envKey: 'ZAI_CODING_API_KEY',
  defaultBaseUrl: 'https://api.z.ai/api/coding/paas/v4',
  defaultModel: 'glm-4.7',
  supportsTools: true,
  supportsThinking: false,
  pricing: null,
};

const CUSTOM_SPEC: ProviderSpec = {
  name: 'custom',
  displayName: 'Custom',
  modelPrefixes: [],
  envKey: 'CUSTOM_API_KEY',
  defaultModel: '',
  supportsTools: false,
  supportsThinking: false,
  pricing: null,
};

const PROVIDERS: readonly ProviderSpec[] = [
  ANTHROPIC_SPEC,
  OPENAI_SPEC,
  ZAI_CODING_SPEC,
  CUSTOM_SPEC,
];

/**
 * Find a provider spec by its name. Returns null if not found.
 */
export function findProviderByName(name: string): ProviderSpec | null {
  return PROVIDERS.find((p) => p.name === name) ?? null;
}

/**
 * Detect which provider a model belongs to based on prefix matching.
 * Returns null if no provider matches.
 */
export function findProviderByModel(model: string): ProviderSpec | null {
  return PROVIDERS.find((p) => p.modelPrefixes.some((prefix) => model.startsWith(prefix))) ?? null;
}

/**
 * Get a provider spec by name. Throws if not found.
 */
export function getProviderSpec(name: string): ProviderSpec {
  const spec = findProviderByName(name);

  if (spec === null) {
    throw new Error(`Provider "${name}" not found`);
  }

  return spec;
}

/**
 * Returns a list of all registered provider specs.
 * Each call returns a new array (immutability).
 */
export function listProviders(): readonly ProviderSpec[] {
  return [...PROVIDERS];
}

/**
 * Estimate USD cost for a given provider/model/token combination.
 * Returns null if pricing is unavailable.
 */
export function estimateCost(
  providerName: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const spec = findProviderByName(providerName);
  const pricingTable = spec?.pricing;

  if (pricingTable === null || pricingTable === undefined) {
    return null;
  }

  // Find the most specific match (longest model name that matches as a prefix)
  const pricing = pricingTable
    .filter((p) => model.startsWith(p.model))
    .sort((a, b) => b.model.length - a.model.length)[0];

  if (pricing === undefined) {
    return null;
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;

  return inputCost + outputCost;
}
