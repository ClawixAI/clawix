import { createLogger } from '@clawix/shared';
import type { ChatMessage, ChatOptions, LLMProvider, LLMResponse, LLMUsage } from '@clawix/shared';

import type { ToolRegistry } from './tool-registry.js';
import type { LoopResult, ReasoningLoopConfig } from './reasoning-loop.types.js';
import type { BudgetTracker } from './budget-tracker.js';

const logger = createLogger('engine:reasoning-loop');

const DEFAULT_MAX_ITERATIONS = 40;
/** Cap for the grace-turn output. Tight enough that the wrap-up cannot blow the hard limit. */
const GRACE_TURN_MAX_TOKENS = 1500;

/* ------------------------------------------------------------------ */
/*  Module-level helpers                                                */
/* ------------------------------------------------------------------ */

/** Returns a new LLMUsage that is the sum of two usage records. */
function addUsage(a: LLMUsage, b: LLMUsage): LLMUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

/** Format tool call arguments into a concise hint string. */
function formatArgs(args: Readonly<Record<string, unknown>>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return '';
  if (keys.length === 1) {
    const value = args[keys[0]!];
    return `"${String(value)}"`;
  }
  return `{${keys.length} args}`;
}

/* ------------------------------------------------------------------ */
/*  ReasoningLoop                                                      */
/* ------------------------------------------------------------------ */

/**
 * Multi-turn reasoning loop that orchestrates LLM calls and tool execution.
 *
 * Iterates: call LLM -> if tool calls, execute via registry -> append results -> call again.
 * Stops when: model produces no tool calls, error finish reason, or max iterations reached.
 */
export class ReasoningLoop {
  private readonly provider: LLMProvider;
  private readonly toolRegistry: ToolRegistry;

  constructor(provider: LLMProvider, toolRegistry: ToolRegistry) {
    this.provider = provider;
    this.toolRegistry = toolRegistry;
  }

  async run(
    initialMessages: readonly ChatMessage[],
    config?: ReasoningLoopConfig,
  ): Promise<LoopResult> {
    const maxIterations = config?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const messages: ChatMessage[] = [...initialMessages];
    let totalUsage: LLMUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let iterations = 0;
    let lastResponse: LLMResponse | null = null;
    let hitTokenBudget = false;
    let hitTimeout = false;
    /** Set when this loop just injected the grace message — next call must use restricted options. */
    let nextCallIsGraceTurn = false;
    const tracker: BudgetTracker | undefined = config?.budgetTracker;

    // Abort controller for timeout and external signal
    const abortController = new AbortController();
    const externalSignal = config?.abortSignal;

    // Link external signal
    if (externalSignal) {
      if (externalSignal.aborted) {
        return {
          content: null,
          messages,
          totalUsage,
          iterations: 0,
          hitMaxIterations: false,
          hitTokenBudget: false,
          hitTimeout: true,
        };
      }
      externalSignal.addEventListener(
        'abort',
        () => {
          hitTimeout = true;
          abortController.abort();
        },
        { once: true },
      );
    }

    // Wall-clock timeout
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (config?.timeoutMs) {
      timeoutHandle = setTimeout(() => {
        hitTimeout = true;
        abortController.abort();
      }, config.timeoutMs);
    }

    const chatOptions: ChatOptions = {
      ...(config?.model ? { model: config.model } : {}),
      tools: this.toolRegistry.getDefinitions(),
      ...(config?.settings ? { settings: config.settings } : {}),
    };

    try {
      while (iterations < maxIterations) {
        if (abortController.signal.aborted) {
          logger.warn(
            { iteration: iterations },
            'Reasoning loop aborted (timeout or external signal)',
          );
          break;
        }

        // Pre-call check: a sibling sub-agent may have exhausted the shared
        // tracker since our last iteration. Skip the call to avoid paying
        // for tokens we would immediately hard-stop on.
        if (tracker?.isOverGrace()) {
          logger.warn(
            { used: tracker.used, budget: tracker.budget, graceLimit: tracker.graceLimit },
            'Token budget exceeded before iteration — hard stop',
          );
          hitTokenBudget = true;
          break;
        }

        iterations += 1;

        logger.debug({ iteration: iterations, maxIterations }, 'Starting iteration');
        logger.debug({ iteration: iterations, messages }, 'Prompt messages sent to LLM');

        // When the previous iteration injected grace, force this call to be
        // a constrained wrap-up: no tools available, output capped tightly.
        // This guarantees the wrap-up turn cannot itself blow the hard limit.
        const callOptions: ChatOptions = nextCallIsGraceTurn
          ? {
              ...chatOptions,
              tools: [],
              settings: { ...chatOptions.settings, maxTokens: GRACE_TURN_MAX_TOKENS },
            }
          : chatOptions;
        nextCallIsGraceTurn = false;

        const response = await this.provider.chat(messages, callOptions);
        lastResponse = response;
        totalUsage = addUsage(totalUsage, response.usage);
        tracker?.record(response.usage);

        // Hard stop: budget + grace exhausted. Could be triggered by this call
        // or by a sub-agent that ran while a previous iteration was awaiting.
        if (tracker?.isOverGrace()) {
          logger.warn(
            { used: tracker.used, budget: tracker.budget, graceLimit: tracker.graceLimit },
            'Token budget exceeded — hard stop',
          );
          messages.push({ role: 'assistant', content: response.content ?? '' });
          hitTokenBudget = true;
          break;
        }

        // Soft stop: reached budget but still within grace. Inject the wrap-up
        // message once per shared tracker so multiple loops don't pile on.
        if (tracker?.shouldInjectGrace()) {
          messages.push({
            role: 'system',
            content:
              'You are at your token limit. Summarize your findings and finish in this turn.',
          });
          tracker.markGraceInjected();
          nextCallIsGraceTurn = true;
          logger.info(
            { used: tracker.used, budget: tracker.budget },
            'Token budget reached — grace turn injected',
          );
        }

        // Error finish reason: stop immediately
        if (response.finishReason === 'error') {
          logger.warn({ iteration: iterations }, 'LLM returned error finish reason');
          messages.push({ role: 'assistant', content: response.content ?? '' });
          break;
        }

        // No tool calls: final response
        if (response.toolCalls.length === 0) {
          messages.push({ role: 'assistant', content: response.content ?? '' });
          break;
        }

        // Tool calls present: push assistant message with tool calls, then execute each
        messages.push({
          role: 'assistant',
          content: response.content ?? '',
          toolCalls: response.toolCalls,
        });

        // Build progress hint and call onProgress
        if (config?.onProgress) {
          const hints = response.toolCalls.map((tc) => `${tc.name}(${formatArgs(tc.arguments)})`);
          config.onProgress(hints.join(', '));
        }

        // Execute each tool call and append result messages
        for (const toolCall of response.toolCalls) {
          logger.debug({ tool: toolCall.name, id: toolCall.id }, 'Executing tool call');

          const result = await this.toolRegistry.execute(toolCall.name, toolCall.arguments);

          messages.push({
            role: 'tool',
            content: result.output,
            toolCallId: toolCall.id,
          });
        }
      }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

    const hitMaxIterations =
      iterations >= maxIterations && lastResponse !== null && lastResponse.toolCalls.length > 0;

    const content = lastResponse?.content ?? null;

    logger.info(
      { iterations, hitMaxIterations, hitTokenBudget, hitTimeout, totalUsage },
      'Reasoning loop completed',
    );

    return {
      content,
      messages,
      totalUsage,
      iterations,
      hitMaxIterations,
      hitTokenBudget,
      hitTimeout,
    };
  }
}
