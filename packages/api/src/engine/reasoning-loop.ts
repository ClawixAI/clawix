import { createLogger } from '@clawix/shared';
import type { ChatMessage, ChatOptions, LLMProvider, LLMResponse, LLMUsage } from '@clawix/shared';

import type { ToolRegistry } from './tool-registry.js';
import type { ToolResult } from './tool.js';
import type { LoopResult, ReasoningLoopConfig } from './reasoning-loop.types.js';
import type { BudgetTracker } from './budget-tracker.js';
import { runWithRecovery } from './recovery-loop.js';
import { classifyError, LoopAbortedError } from './error-classifier.js';
import { ToolLoopGuard } from './tool-loop-guard.js';
import { wireRecoveryMetrics, toolLoopAbortedTotal } from './recovery-metrics.js';
import { CompressorService } from './compressor.js';
import { SKILL_STALENESS_THRESHOLD_DAYS } from './skill-loader.types.js';

const logger = createLogger('engine:reasoning-loop');

const DEFAULT_MAX_ITERATIONS = 40;
/** Cap for the grace-turn output. Tight enough that the wrap-up cannot blow the hard limit. */
const GRACE_TURN_MAX_TOKENS = 1500;
/** A tool running longer than this (ms) is logged as slow while still in flight. */
const DEFAULT_SLOW_TOOL_WARN_MS = 30_000;
/** Interval (ms) between "still alive" heartbeat logs so a hang surfaces before the watchdog. */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;
/** Grace (ms) after an abort before an unresponsive tool is flagged as ignoring the signal. */
const DEFAULT_ABORT_GRACE_MS = 5_000;

/** Best-effort unref so a stray timer never keeps the process alive. */
function unref(handle: ReturnType<typeof setTimeout>): void {
  if (typeof handle === 'object' && handle !== null && typeof handle.unref === 'function') {
    handle.unref();
  }
}

/* ------------------------------------------------------------------ */
/*  Module-level helpers                                                */
/* ------------------------------------------------------------------ */

/** Returns a new LLMUsage that is the sum of two usage records. */
function addUsage(a: LLMUsage, b: LLMUsage): LLMUsage {
  const cacheCreation = (a.cacheCreationInputTokens ?? 0) + (b.cacheCreationInputTokens ?? 0);
  const cacheRead = (a.cacheReadInputTokens ?? 0) + (b.cacheReadInputTokens ?? 0);
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    ...(cacheCreation > 0 ? { cacheCreationInputTokens: cacheCreation } : {}),
    ...(cacheRead > 0 ? { cacheReadInputTokens: cacheRead } : {}),
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
  constructor(
    private readonly provider: LLMProvider,
    private readonly toolRegistry: ToolRegistry,
    private readonly compressor: CompressorService,
    private readonly providerInfo: { provider: string; model: string },
  ) {}

  async run(
    initialMessages: readonly ChatMessage[],
    config?: ReasoningLoopConfig,
  ): Promise<LoopResult> {
    const maxIterations = config?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    // Run-scoped logger: carries { agentRunId, sessionId } when supplied so
    // concurrent sub-agents' loop lines are individually greppable.
    const log = config?.logger ?? logger;
    const observer = config?.observer;
    const slowToolWarnMs = config?.slowToolWarnMs ?? DEFAULT_SLOW_TOOL_WARN_MS;
    const heartbeatIntervalMs = config?.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    const abortGraceMs = config?.abortGraceMs ?? DEFAULT_ABORT_GRACE_MS;
    const runStartedAt = Date.now();
    // Live tool state, read by the heartbeat so a hang names the stuck tool.
    let currentToolName: string | null = null;
    let currentToolStartedAt = 0;
    // Set when abort fired while the current tool is still in flight; lets the
    // heartbeat re-surface the ignoring-abort state over the whole stuck window.
    let currentToolAbortedAt: number | null = null;
    let messages: ChatMessage[] = [...initialMessages];
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
      // Forward the loop's abort signal so the provider's SDK call is
      // cancelled in-flight when the timeout fires (or an external abort
      // signal triggers). Without this, a timeout would unwind the loop
      // but leave the LLM HTTPS request open — wasting tokens and a slot.
      abortSignal: abortController.signal,
    };

    const toolLoopGuard = new ToolLoopGuard();
    const stalenessMap = config?.stalenessMap;
    const injectedSkills = new Set<string>();

    // Heartbeat: periodic "still alive" line naming the tool the loop is stuck
    // in, so a wedge surfaces before the executor watchdog fires. Gated to
    // in-tool time — healthy inter-iteration waits (covered by the debug
    // "Starting iteration" + tool logs) stay quiet. When abort has fired but
    // the tool runs on, it also carries the elapsed-since-abort so the
    // ignoring-abort state is re-surfaced across the whole stuck window.
    const heartbeat = setInterval(() => {
      if (currentToolName === null) return;
      log.info(
        {
          iteration: iterations,
          tool: currentToolName,
          toolElapsedMs: Date.now() - currentToolStartedAt,
          runElapsedMs: Date.now() - runStartedAt,
          ...(currentToolAbortedAt !== null
            ? { abortIgnoredMs: Date.now() - currentToolAbortedAt }
            : {}),
        },
        'Reasoning loop heartbeat',
      );
    }, heartbeatIntervalMs);
    unref(heartbeat);

    try {
      while (iterations < maxIterations) {
        if (abortController.signal.aborted) {
          log.warn(
            { iteration: iterations },
            'Reasoning loop aborted (timeout or external signal)',
          );
          break;
        }

        // Pre-call check: a sibling sub-agent may have exhausted the shared
        // tracker since our last iteration. Skip the call to avoid paying
        // for tokens we would immediately hard-stop on.
        if (tracker?.isOverGrace()) {
          log.warn(
            { used: tracker.used, budget: tracker.budget, graceLimit: tracker.graceLimit },
            'Token budget exceeded before iteration — hard stop',
          );
          hitTokenBudget = true;
          break;
        }

        iterations += 1;
        observer?.onIteration?.(iterations);

        log.debug({ iteration: iterations, maxIterations }, 'Starting iteration');
        log.debug({ iteration: iterations, messages }, 'Prompt messages sent to LLM');

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

        let response: LLMResponse;
        try {
          const recoveryResult = await runWithRecovery(this.provider, messages, callOptions, {
            classifier: classifyError,
            compressor: (msgs) => this.compressor.compress(msgs, this.providerInfo),
            onRecoveryEvent: wireRecoveryMetrics,
            provider: this.providerInfo.provider,
          });
          response = recoveryResult.response;
          // Adopt possibly-compressed messages for subsequent iterations.
          messages = [...recoveryResult.messages];
        } catch (err: unknown) {
          // If abort fired while the SDK call was in flight, the provider
          // throws an AbortError. Treat that as a clean timeout exit rather
          // than letting it propagate as a hard failure.
          if (abortController.signal.aborted) {
            log.warn({ iteration: iterations }, 'Provider chat aborted by signal — exiting loop');
            break;
          }
          throw err;
        }
        lastResponse = response;
        totalUsage = addUsage(totalUsage, response.usage);
        tracker?.record(response.usage);

        // Streaming: emit the iteration's prose immediately if non-empty.
        // `isFinal` lets consumers distinguish the closing chunk from
        // intermediate ones without a separate end-of-stream event.
        if (config?.onEvent && response.content && response.content.trim().length > 0) {
          await config.onEvent({
            type: 'assistant_chunk',
            content: response.content,
            isFinal: response.toolCalls.length === 0,
          });
        }

        // Hard stop: budget + grace exhausted. Could be triggered by this call
        // or by a sub-agent that ran while a previous iteration was awaiting.
        if (tracker?.isOverGrace()) {
          log.warn(
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
          log.info(
            { used: tracker.used, budget: tracker.budget },
            'Token budget reached — grace turn injected',
          );
        }

        // Error finish reason: stop immediately
        if (response.finishReason === 'error') {
          log.warn({ iteration: iterations }, 'LLM returned error finish reason');
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
          log.debug({ tool: toolCall.name, id: toolCall.id }, 'Executing tool call');

          // Streaming: announce the tool call before running it so the
          // channel can render a progress bubble while the tool executes.
          if (config?.onEvent) {
            await config.onEvent({
              type: 'tool_started',
              name: toolCall.name,
              args: toolCall.arguments,
            });
          }

          // Mark the tool live for the heartbeat + observer (watchdog read).
          currentToolName = toolCall.name;
          currentToolStartedAt = Date.now();
          observer?.onToolStart?.(toolCall.name);

          // Slow-tool warn: fires while the tool is still running, so a hang is
          // visible without waiting for the wall-clock timeout.
          const slowTimer = setTimeout(() => {
            log.warn(
              {
                tool: toolCall.name,
                elapsedMs: Date.now() - currentToolStartedAt,
                iteration: iterations,
              },
              'Tool still running past slow threshold',
            );
          }, slowToolWarnMs);
          unref(slowTimer);

          // Abort-ignored watch: if abort fires while this tool is in flight and
          // it doesn't return within the grace window, the tool is ignoring the
          // signal — the real culprit behind a run that won't settle.
          let abortTimer: ReturnType<typeof setTimeout> | undefined;
          const armAbortWatch = (): void => {
            // Record abort time so the heartbeat can re-surface the ignoring-
            // abort state; the one-shot warn below is the first, loud signal.
            currentToolAbortedAt = Date.now();
            abortTimer = setTimeout(() => {
              log.warn(
                { tool: toolCall.name, msSinceAbort: abortGraceMs, iteration: iterations },
                'Tool ignoring abort signal (still running after grace)',
              );
            }, abortGraceMs);
            unref(abortTimer);
          };
          if (abortController.signal.aborted) armAbortWatch();
          else abortController.signal.addEventListener('abort', armAbortWatch, { once: true });

          let result: ToolResult;
          try {
            result = await this.toolRegistry.execute(toolCall.name, toolCall.arguments, {
              abortSignal: abortController.signal,
            });
          } finally {
            clearTimeout(slowTimer);
            if (abortTimer) clearTimeout(abortTimer);
            abortController.signal.removeEventListener('abort', armAbortWatch);
            log.debug(
              {
                tool: toolCall.name,
                durationMs: Date.now() - currentToolStartedAt,
                iteration: iterations,
              },
              'Tool completed',
            );
            observer?.onToolEnd?.(toolCall.name);
            currentToolName = null;
            currentToolAbortedAt = null;
          }
          try {
            toolLoopGuard.record(toolCall.name, toolCall.arguments, result.isError);
          } catch (loopErr) {
            if (loopErr instanceof LoopAbortedError) {
              toolLoopAbortedTotal.inc({ tool_name: loopErr.toolName });
            }
            throw loopErr;
          }

          messages.push({
            role: 'tool',
            content: result.output,
            toolCallId: toolCall.id,
          });

          if (
            !result.isError &&
            stalenessMap &&
            stalenessMap.size > 0 &&
            toolCall.name === 'read_file'
          ) {
            const filePath = String(toolCall.arguments['path'] ?? '');
            if (!injectedSkills.has(filePath)) {
              const entry = stalenessMap.get(filePath);
              if (entry) {
                injectedSkills.add(filePath);
                const stalenessHint = entry.stale
                  ? ` (not updated in ${SKILL_STALENESS_THRESHOLD_DAYS}+ days)`
                  : '';
                messages.push({
                  role: 'system',
                  content:
                    `You just loaded skill "${entry.name}"${stalenessHint}. ` +
                    `After completing the current task using this skill, reflect: ` +
                    `did the skill accurately guide you? If anything was wrong, missing, ` +
                    `or outdated, patch it with edit_file before moving on.`,
                });
              }
            }
          }
        }
      }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      clearInterval(heartbeat);
    }

    const hitMaxIterations =
      iterations >= maxIterations && lastResponse !== null && lastResponse.toolCalls.length > 0;

    const content = lastResponse?.content ?? null;

    log.info(
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
