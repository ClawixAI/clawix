import { describe, expect, it, vi } from 'vitest';

import {
  resolveVisionConfig,
  type AgentDefForVision,
  type VisionResolverDeps,
} from './vision-config-resolver.js';

const baseAgent: AgentDefForVision = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  apiBaseUrl: null,
  toolConfig: {},
};

const policy = { name: 'Standard', allowedProviders: ['anthropic', 'openai', 'gemini'] };

function buildDeps(overrides?: Partial<VisionResolverDeps>): VisionResolverDeps {
  return {
    findAgentById:
      overrides?.findAgentById ??
      vi.fn(async () => {
        throw new Error('findAgentById not stubbed');
      }),
    resolveProvider:
      overrides?.resolveProvider ??
      vi.fn(async () => ({ apiKey: 'delegate-key', apiBaseUrl: null })),
  };
}

describe('resolveVisionConfig — no override', () => {
  it("uses the agent's own provider+model and reports capable=true for vision-capable models", async () => {
    const deps = buildDeps();
    const out = await resolveVisionConfig(deps, {
      agentDef: baseAgent,
      resolvedApiKey: 'primary-key',
      resolvedApiBaseUrl: undefined,
      policy,
      budgetTracker: undefined,
    });

    expect(out).toMatchObject({
      available: true,
      capable: true,
      providerLabel: 'anthropic',
      modelLabel: 'claude-sonnet-4-20250514',
    });
    expect(deps.findAgentById).not.toHaveBeenCalled();
  });

  it("reports capable=false when the agent's default model is not vision-capable", async () => {
    const out = await resolveVisionConfig(buildDeps(), {
      agentDef: { ...baseAgent, provider: 'openai', model: 'gpt-3.5-turbo' },
      resolvedApiKey: 'k',
      resolvedApiBaseUrl: undefined,
      policy,
      budgetTracker: undefined,
    });

    expect(out).toMatchObject({ available: true, capable: false, modelLabel: 'gpt-3.5-turbo' });
  });
});

describe('resolveVisionConfig — same-provider model override (override-trust)', () => {
  it('uses the override as the model and trusts it (capable=true even for unknown patterns)', async () => {
    // Operator picks a Z.ai vision model on a zai-coding agent. The substring
    // check would say "no" — but the explicit override means we trust them.
    const out = await resolveVisionConfig(buildDeps(), {
      agentDef: {
        provider: 'zai-coding',
        model: 'glm-4.5',
        apiBaseUrl: 'https://api.z.ai/api/coding/paas/v4',
        toolConfig: { modelOverrides: { browser_vision: 'glm-4.5v' } },
      },
      resolvedApiKey: 'zai-key',
      resolvedApiBaseUrl: 'https://api.z.ai/api/coding/paas/v4',
      policy,
      budgetTracker: undefined,
    });

    expect(out).toMatchObject({
      available: true,
      capable: true,
      providerLabel: 'zai-coding',
      modelLabel: 'glm-4.5v',
    });
  });
});

describe('resolveVisionConfig — agent: delegation', () => {
  it("routes through the delegate's provider/model/credentials", async () => {
    const findAgentById = vi.fn(async () => ({
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      apiBaseUrl: null,
      toolConfig: {},
    }));
    const resolveProvider = vi.fn(async () => ({
      apiKey: 'gemini-key',
      apiBaseUrl: null,
    }));
    const deps = buildDeps({ findAgentById, resolveProvider });

    const out = await resolveVisionConfig(deps, {
      agentDef: {
        ...baseAgent,
        toolConfig: { modelOverrides: { browser_vision: 'agent:c1234567890abcdef0123456' } },
      },
      resolvedApiKey: 'primary-anthropic-key',
      resolvedApiBaseUrl: undefined,
      policy,
      budgetTracker: undefined,
    });

    expect(out).toMatchObject({
      available: true,
      capable: true,
      providerLabel: 'gemini',
      modelLabel: 'gemini-2.5-pro',
    });
    expect(findAgentById).toHaveBeenCalledWith('c1234567890abcdef0123456');
    expect(resolveProvider).toHaveBeenCalledWith('gemini');
  });

  it('rejects delegation to a provider not in policy.allowedProviders', async () => {
    const findAgentById = vi.fn(async () => ({
      provider: 'openai',
      model: 'gpt-4o',
      apiBaseUrl: null,
      toolConfig: {},
    }));
    const deps = buildDeps({ findAgentById });

    const out = await resolveVisionConfig(deps, {
      agentDef: {
        ...baseAgent,
        toolConfig: { modelOverrides: { browser_vision: 'agent:cabcdefghijk' } },
      },
      resolvedApiKey: 'k',
      resolvedApiBaseUrl: undefined,
      // Policy only allows anthropic — OpenAI delegation must be refused.
      policy: { name: 'Standard', allowedProviders: ['anthropic'] },
      budgetTracker: undefined,
    });

    expect(out).toEqual({
      available: false,
      reason: expect.stringContaining('not allowed by policy "Standard"'),
    });
  });

  it('returns a clear error when the delegate agent is not found', async () => {
    const findAgentById = vi.fn(async () => {
      throw new Error('AgentDefinition with id missing-id not found');
    });
    const deps = buildDeps({ findAgentById });

    const out = await resolveVisionConfig(deps, {
      agentDef: {
        ...baseAgent,
        toolConfig: { modelOverrides: { browser_vision: 'agent:missing-id' } },
      },
      resolvedApiKey: 'k',
      resolvedApiBaseUrl: undefined,
      policy,
      budgetTracker: undefined,
    });

    expect(out).toEqual({
      available: false,
      reason: expect.stringContaining('not found'),
    });
  });

  it("returns a clear error when the delegate's provider config cannot be resolved", async () => {
    const findAgentById = vi.fn(async () => ({
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      apiBaseUrl: null,
      toolConfig: {},
    }));
    const resolveProvider = vi.fn(async () => {
      throw new Error('No provider config found for "gemini"');
    });
    const deps = buildDeps({ findAgentById, resolveProvider });

    const out = await resolveVisionConfig(deps, {
      agentDef: {
        ...baseAgent,
        toolConfig: { modelOverrides: { browser_vision: 'agent:cabc' } },
      },
      resolvedApiKey: 'k',
      resolvedApiBaseUrl: undefined,
      policy,
      budgetTracker: undefined,
    });

    expect(out).toEqual({
      available: false,
      reason: expect.stringContaining('No provider config found'),
    });
  });

  it('rejects an empty agent: id', async () => {
    const out = await resolveVisionConfig(buildDeps(), {
      agentDef: {
        ...baseAgent,
        toolConfig: { modelOverrides: { browser_vision: 'agent:' } },
      },
      resolvedApiKey: 'k',
      resolvedApiBaseUrl: undefined,
      policy,
      budgetTracker: undefined,
    });

    expect(out).toEqual({
      available: false,
      reason: expect.stringContaining('expected "agent:<id>"'),
    });
  });
});
