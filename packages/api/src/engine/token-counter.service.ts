/**
 * Token counter service — records token usage and enforces policy budgets.
 */

import { Injectable } from '@nestjs/common';
import { createLogger, estimateCost, type LLMResponse, type LLMUsage } from '@clawix/shared';

import { PolicyRepository } from '../db/policy.repository.js';
import { TokenUsageRepository } from '../db/token-usage.repository.js';

const log = createLogger('engine:token-counter');

/** Input for recording a single LLM call's token usage. */
export interface RecordUsageInput {
  readonly response: LLMResponse;
  readonly agentRunId: string;
  readonly userId: string;
  readonly providerName: string;
  readonly model: string;
}

/** Input for recording aggregate usage from a reasoning loop run. */
export interface RecordAggregateUsageInput {
  readonly usage: LLMUsage;
  readonly agentRunId: string;
  readonly userId: string;
  readonly providerName: string;
  readonly model: string;
}

/** Result of a budget check against a user's policy. */
export interface BudgetCheckResult {
  readonly allowed: boolean;
  readonly currentUsageUsd: number;
  readonly limitUsd: number | null;
}

@Injectable()
export class TokenCounterService {
  constructor(
    private readonly tokenUsageRepo: TokenUsageRepository,
    private readonly policyRepo: PolicyRepository,
  ) {}

  /**
   * Record token usage for an LLM call.
   * Extracts usage from the response, estimates cost, and persists.
   */
  async recordUsage(input: RecordUsageInput): Promise<void> {
    const { response, agentRunId, userId, providerName, model } = input;
    const {
      inputTokens,
      outputTokens,
      totalTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
    } = response.usage;

    const costUsd = estimateCost(providerName, model, inputTokens, outputTokens, {
      cacheCreationTokens: cacheCreationInputTokens,
      cacheReadTokens: cacheReadInputTokens,
    });

    log.debug(
      {
        agentRunId,
        userId,
        providerName,
        model,
        inputTokens,
        outputTokens,
        totalTokens,
        cacheCreationInputTokens,
        cacheReadInputTokens,
        estimatedCostUsd: costUsd,
      },
      'Recording token usage',
    );

    await this.tokenUsageRepo.create({
      agentRunId,
      userId,
      model,
      inputTokens,
      outputTokens,
      totalTokens,
      ...(cacheCreationInputTokens !== undefined
        ? { cacheCreationTokens: cacheCreationInputTokens }
        : {}),
      ...(cacheReadInputTokens !== undefined ? { cacheReadTokens: cacheReadInputTokens } : {}),
      ...(costUsd !== null ? { estimatedCostUsd: costUsd } : {}),
    });
  }

  /**
   * Record aggregate token usage from a reasoning loop run.
   * Unlike recordUsage() which takes an LLMResponse, this accepts
   * LLMUsage directly — suitable for LoopResult.totalUsage.
   */
  async recordAggregateUsage(input: RecordAggregateUsageInput): Promise<void> {
    const { usage, agentRunId, userId, providerName, model } = input;
    const {
      inputTokens,
      outputTokens,
      totalTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
    } = usage;

    const costUsd = estimateCost(providerName, model, inputTokens, outputTokens, {
      cacheCreationTokens: cacheCreationInputTokens,
      cacheReadTokens: cacheReadInputTokens,
    });

    log.debug(
      {
        agentRunId,
        userId,
        providerName,
        model,
        inputTokens,
        outputTokens,
        cacheCreationInputTokens,
        cacheReadInputTokens,
        costUsd,
      },
      'Recording aggregate token usage',
    );

    await this.tokenUsageRepo.create({
      agentRunId,
      userId,
      model,
      inputTokens,
      outputTokens,
      totalTokens,
      ...(cacheCreationInputTokens !== undefined
        ? { cacheCreationTokens: cacheCreationInputTokens }
        : {}),
      ...(cacheReadInputTokens !== undefined ? { cacheReadTokens: cacheReadInputTokens } : {}),
      ...(costUsd !== null ? { estimatedCostUsd: costUsd } : {}),
    });
  }

  /**
   * Check whether a user is within their policy's token budget for the current month.
   */
  async checkBudget(userId: string, policyId: string): Promise<BudgetCheckResult> {
    const policy = await this.policyRepo.findById(policyId);

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const usage = await this.tokenUsageRepo.sumByUserId(userId, startOfMonth, endOfMonth);
    const currentUsageUsd = usage.totalEstimatedCostUsd;

    if (policy.maxTokenBudget === null) {
      return { allowed: true, currentUsageUsd, limitUsd: null };
    }

    // maxTokenBudget is stored in cents — convert to USD
    const limitUsd = policy.maxTokenBudget / 100;

    return {
      allowed: currentUsageUsd < limitUsd,
      currentUsageUsd,
      limitUsd,
    };
  }

  /**
   * Check whether a provider is allowed by the user's policy.
   */
  async checkProviderAllowed(policyId: string, providerName: string): Promise<boolean> {
    const policy = await this.policyRepo.findById(policyId);
    return policy.allowedProviders.includes(providerName);
  }
}
