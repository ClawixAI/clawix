import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLLMResponse, type LLMResponse } from '@clawix/shared';

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

import { TokenCounterService } from '../token-counter.service.js';
import type { TokenUsageRepository } from '../../db/token-usage.repository.js';
import type { PolicyRepository } from '../../db/policy.repository.js';

function makeMockResponse(overrides: Partial<LLMResponse> = {}): LLMResponse {
  return {
    content: 'Hello',
    toolCalls: [],
    finishReason: 'stop',
    usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
    thinkingBlocks: null,
    ...overrides,
  };
}

describe('TokenCounterService', () => {
  let service: TokenCounterService;
  let tokenUsageRepo: {
    create: ReturnType<typeof vi.fn>;
    sumByUserId: ReturnType<typeof vi.fn>;
  };
  let policyRepo: {
    findById: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    tokenUsageRepo = {
      create: vi.fn().mockResolvedValue(undefined),
      sumByUserId: vi.fn(),
    };
    policyRepo = {
      findById: vi.fn(),
    };
    service = new TokenCounterService(
      tokenUsageRepo as unknown as TokenUsageRepository,
      policyRepo as unknown as PolicyRepository,
    );
  });

  describe('recordUsage', () => {
    it('stores token usage with cost estimate', async () => {
      const response = makeMockResponse();

      await service.recordUsage({
        response,
        agentRunId: 'run-1',
        userId: 'user-1',
        providerName: 'openai',
        model: 'gpt-4o',
      });

      expect(tokenUsageRepo.create).toHaveBeenCalledOnce();
      const arg = tokenUsageRepo.create.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(arg).toMatchObject({
        agentRunId: 'run-1',
        userId: 'user-1',
        model: 'gpt-4o',
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      });
      // estimatedCostUsd should be defined (openai gpt-4o has known pricing)
      expect(arg['estimatedCostUsd']).toBeDefined();
      expect(typeof arg['estimatedCostUsd']).toBe('number');
    });

    it('calculates cost using provider pricing', async () => {
      const response = makeMockResponse({
        usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 },
      });

      await service.recordUsage({
        response,
        agentRunId: 'run-2',
        userId: 'user-1',
        providerName: 'openai',
        model: 'gpt-4o',
      });

      const arg = tokenUsageRepo.create.mock.calls[0]?.[0] as Record<string, unknown>;
      // gpt-4o: input=$2.5/M, output=$10/M → $2.5 + $10 = $12.5
      expect(arg['estimatedCostUsd']).toBeCloseTo(12.5, 2);
    });
  });

  describe('checkBudget', () => {
    it('returns allowed when under budget', async () => {
      policyRepo.findById.mockResolvedValue({
        id: 'policy-1',
        maxTokenBudget: 5000, // 5000 cents = $50
        allowedProviders: ['openai'],
      });
      tokenUsageRepo.sumByUserId.mockResolvedValue({
        totalEstimatedCostUsd: 10, // $10 used
      });

      const result = await service.checkBudget('user-1', 'policy-1');

      expect(result).toEqual({
        allowed: true,
        currentUsageUsd: 10,
        limitUsd: 50,
      });
    });

    it('returns denied when over budget', async () => {
      policyRepo.findById.mockResolvedValue({
        id: 'policy-1',
        maxTokenBudget: 1000, // 1000 cents = $10
        allowedProviders: ['openai'],
      });
      tokenUsageRepo.sumByUserId.mockResolvedValue({
        totalEstimatedCostUsd: 15, // $15 used, over $10 limit
      });

      const result = await service.checkBudget('user-1', 'policy-1');

      expect(result).toEqual({
        allowed: false,
        currentUsageUsd: 15,
        limitUsd: 10,
      });
    });

    it('returns denied when usage exactly equals budget limit', async () => {
      policyRepo.findById.mockResolvedValue({
        id: 'policy-1',
        maxTokenBudget: 1000, // 1000 cents = $10
        allowedProviders: ['openai'],
      });
      tokenUsageRepo.sumByUserId.mockResolvedValue({
        totalEstimatedCostUsd: 10, // exactly at $10 limit
      });

      const result = await service.checkBudget('user-1', 'policy-1');

      expect(result.allowed).toBe(false);
    });

    it('returns allowed when policy has no budget limit (null)', async () => {
      policyRepo.findById.mockResolvedValue({
        id: 'policy-1',
        maxTokenBudget: null,
        allowedProviders: ['openai'],
      });
      tokenUsageRepo.sumByUserId.mockResolvedValue({
        totalEstimatedCostUsd: 999,
      });

      const result = await service.checkBudget('user-1', 'policy-1');

      expect(result).toEqual({
        allowed: true,
        currentUsageUsd: 999,
        limitUsd: null,
      });
    });
  });

  describe('checkProviderAllowed', () => {
    it('returns true when provider is in allowedProviders', async () => {
      policyRepo.findById.mockResolvedValue({
        id: 'policy-1',
        allowedProviders: ['openai', 'anthropic'],
      });

      const result = await service.checkProviderAllowed('policy-1', 'openai');
      expect(result).toBe(true);
    });

    it('returns false when provider is not in allowedProviders', async () => {
      policyRepo.findById.mockResolvedValue({
        id: 'policy-1',
        allowedProviders: ['anthropic'],
      });

      const result = await service.checkProviderAllowed('policy-1', 'openai');
      expect(result).toBe(false);
    });
  });
});

describe('TokenCounterService — cache token plumbing', () => {
  it('forwards cache token counts to the repo on recordUsage', async () => {
    const repo = { create: vi.fn().mockResolvedValue({}) };
    const policyRepo = { findById: vi.fn() };
    const svc = new TokenCounterService(
      repo as unknown as TokenUsageRepository,
      policyRepo as unknown as PolicyRepository,
    );

    await svc.recordUsage({
      response: createLLMResponse({
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 5270,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 5120,
        },
      }),
      agentRunId: 'run-1',
      userId: 'user-1',
      providerName: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 5270,
        cacheCreationTokens: 0,
        cacheReadTokens: 5120,
      }),
    );
  });

  it('applies cache pricing to estimatedCostUsd', async () => {
    const repo = { create: vi.fn().mockResolvedValue({}) };
    const policyRepo = { findById: vi.fn() };
    const svc = new TokenCounterService(
      repo as unknown as TokenUsageRepository,
      policyRepo as unknown as PolicyRepository,
    );

    // 1M cache reads on sonnet-4 → $0.30
    await svc.recordUsage({
      response: createLLMResponse({
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 1_000_000,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 1_000_000,
        },
      }),
      agentRunId: 'run-1',
      userId: 'user-1',
      providerName: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    });

    const call = repo.create.mock.calls[0]![0];
    expect(call.estimatedCostUsd).toBeCloseTo(0.3, 5);
  });

  it('omits cache fields from the repo payload when the response has no cache data', async () => {
    const repo = { create: vi.fn().mockResolvedValue({}) };
    const policyRepo = { findById: vi.fn() };
    const svc = new TokenCounterService(
      repo as unknown as TokenUsageRepository,
      policyRepo as unknown as PolicyRepository,
    );

    await svc.recordUsage({
      response: createLLMResponse({
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }),
      agentRunId: 'run-1',
      userId: 'user-1',
      providerName: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    });

    const call = repo.create.mock.calls[0]![0];
    expect(call.cacheCreationTokens).toBeUndefined();
    expect(call.cacheReadTokens).toBeUndefined();
  });
});
