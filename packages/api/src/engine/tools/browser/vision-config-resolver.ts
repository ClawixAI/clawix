/**
 * Resolve the vision configuration for `browser_vision`, honoring any
 * `agentDefinition.toolConfig.modelOverrides.browser_vision` override:
 *
 *   - `agent:<id>` → delegate to that agent's provider/model/credentials,
 *     subject to the user's `policy.allowedProviders`.
 *   - any other string → same-provider model name override; the substring
 *     vision-capability check is skipped because the operator's choice
 *     trumps our model list.
 *   - absent → use the agent's own provider+model.
 *
 * Resolution failures (delegate not found, provider not allowed, missing
 * provider config) are returned as `{ available: false, reason }` so the
 * tool can surface a clear error to the agent without crashing the run.
 */

import type { BudgetTracker } from '../../budget-tracker.js';
import type { VisionConfig } from './tools/browser-navigate.js';
import { callVisionModel, supportsVisionModel } from './vision-gateway.js';

/** Minimal projection of `AgentDefinition` we read during resolution. */
export interface AgentDefForVision {
  readonly provider: string;
  readonly model: string;
  readonly apiBaseUrl: string | null;
  readonly toolConfig: unknown;
}

/** Minimal projection of `Policy` we read during resolution. */
export interface PolicyForVision {
  readonly name: string;
  readonly allowedProviders: readonly string[];
}

/** Repo callbacks lifted to function form so the resolver is unit-testable. */
export interface VisionResolverDeps {
  readonly findAgentById: (id: string) => Promise<AgentDefForVision>;
  readonly resolveProvider: (providerName: string) => Promise<{
    readonly apiKey: string;
    readonly apiBaseUrl: string | null;
  }>;
}

export interface VisionResolveArgs {
  readonly agentDef: AgentDefForVision;
  readonly resolvedApiKey: string;
  readonly resolvedApiBaseUrl: string | undefined;
  readonly policy: PolicyForVision;
  readonly budgetTracker: BudgetTracker | undefined;
}

const AGENT_PREFIX = 'agent:';

export async function resolveVisionConfig(
  deps: VisionResolverDeps,
  args: VisionResolveArgs,
): Promise<VisionConfig> {
  const overrideRaw = (
    (args.agentDef.toolConfig ?? {}) as { modelOverrides?: Record<string, string> }
  ).modelOverrides?.['browser_vision'];
  const explicitOverride = typeof overrideRaw === 'string' && overrideRaw.trim().length > 0;

  let provider = args.agentDef.provider;
  let model = args.agentDef.model;
  let apiKey = args.resolvedApiKey;
  let apiBaseUrl = args.resolvedApiBaseUrl;

  if (explicitOverride) {
    const trimmed = overrideRaw.trim();
    if (trimmed.startsWith(AGENT_PREFIX)) {
      const delegateId = trimmed.slice(AGENT_PREFIX.length).trim();
      if (!delegateId) {
        return {
          available: false,
          reason: `invalid override "${trimmed}": expected "${AGENT_PREFIX}<id>"`,
        };
      }

      let delegate: AgentDefForVision;
      try {
        delegate = await deps.findAgentById(delegateId);
      } catch {
        return {
          available: false,
          reason: `vision-delegation target "${delegateId}" not found`,
        };
      }

      if (!args.policy.allowedProviders.includes(delegate.provider)) {
        return {
          available: false,
          reason:
            `vision-delegation rejected: provider "${delegate.provider}" ` +
            `is not allowed by policy "${args.policy.name}"`,
        };
      }

      try {
        const delegateResolved = await deps.resolveProvider(delegate.provider);
        provider = delegate.provider;
        model = delegate.model;
        apiKey = delegateResolved.apiKey;
        apiBaseUrl = delegate.apiBaseUrl ?? delegateResolved.apiBaseUrl ?? undefined;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return {
          available: false,
          reason: `vision-delegation failed to resolve provider config: ${reason}`,
        };
      }
    } else {
      // Same-provider model name override; trust the operator.
      model = trimmed;
    }
  }

  const capable = explicitOverride || supportsVisionModel(provider, model);
  const trackerOpt = args.budgetTracker ? { budgetTracker: args.budgetTracker } : {};

  return {
    available: true,
    capable,
    providerLabel: provider,
    modelLabel: model,
    call: async (screenshotPng: Buffer, prompt: string): Promise<string> =>
      callVisionModel({
        provider,
        model,
        image: { mimeType: 'image/png', data: screenshotPng },
        prompt,
        apiKey,
        ...(apiBaseUrl ? { apiBaseUrl } : {}),
        ...trackerOpt,
      }),
  };
}
