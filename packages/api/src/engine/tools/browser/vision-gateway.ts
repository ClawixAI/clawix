/**
 * VisionGateway — provider-agnostic dispatch layer for vision (image-in,
 * text-out) calls used by `browser_vision`.
 *
 * The shared `LLMProvider.chat()` interface is text-only (`ChatMessage.content`
 * is a string), so vision can't ride the normal provider plumbing without a
 * larger refactor. This module instead holds the raw SDK clients for
 * Anthropic, OpenAI, and Gemini and dispatches based on the agent's
 * configured provider.
 *
 * Token usage is recorded into the run's `BudgetTracker` (when supplied), so
 * vision calls count against per-Plan token budgets just like chat calls do.
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { createLogger, type LLMUsage } from '@clawix/shared';

import type { BudgetTracker } from '../../budget-tracker.js';

const logger = createLogger('engine:tools:browser:vision-gateway');

const VISION_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 1024;

/**
 * Substring patterns identifying vision-capable models per provider family.
 * Matched against the lowercased model id, so any future minor/version suffix
 * is covered automatically.
 */
const ANTHROPIC_VISION_PATTERNS = ['claude-3', 'claude-sonnet-', 'claude-opus-', 'claude-haiku-'];

const OPENAI_VISION_PATTERNS = [
  'gpt-4o',
  'gpt-4-turbo',
  'gpt-4-vision',
  'gpt-4.1',
  'gpt-5',
  'o1',
  'o3',
  'o4',
];

const GEMINI_VISION_PATTERNS = ['gemini-1.5', 'gemini-2', 'gemini-3'];

/** Resolve the configured provider name to a vision SDK family. */
export type VisionFamily = 'anthropic' | 'openai' | 'gemini';

/**
 * Map a provider name to the SDK shape used for image input.
 *
 * - `anthropic` and `kimi-code` speak the Anthropic Messages API.
 * - `openai` and `zai-coding` speak the OpenAI Chat Completions API.
 * - `gemini` speaks the Google GenAI API.
 * - Any other provider (custom OpenAI-compatible endpoints, BYO baseURL) is
 *   assumed OpenAI-shaped — this mirrors the engine's provider-factory.ts
 *   fallback that routes unknown providers through `OpenAIProvider`.
 *
 * The returned family only fixes the wire protocol. Whether the chosen model
 * actually supports image input is a separate concern (see
 * `supportsVisionModel`); operators using non-canonical providers should set
 * `agentDefinition.toolConfig.modelOverrides.browser_vision` to an explicit
 * vision-capable model on their service.
 */
export function visionFamily(providerName: string): VisionFamily {
  switch (providerName) {
    case 'anthropic':
    case 'kimi-code':
      return 'anthropic';
    case 'gemini':
      return 'gemini';
    case 'openai':
    case 'zai-coding':
    default:
      return 'openai';
  }
}

/**
 * Friendly capability check for the canonical providers (anthropic / openai /
 * gemini). Returns `true` only when the model name matches a known vision
 * pattern for one of those providers.
 *
 * Returns `false` for non-canonical providers (kimi-code, zai-coding, BYO
 * OpenAI-compatible endpoints) regardless of the model — those services use
 * their own model naming, so we can't substring-match. Operators using these
 * providers should set `modelOverrides.browser_vision` explicitly; an explicit
 * override skips this check (see `browser_vision` tool).
 */
export function supportsVisionModel(providerName: string, model: string): boolean {
  if (!isCanonicalProvider(providerName)) return false;
  const family = visionFamily(providerName);
  const lower = model.toLowerCase();
  const patterns =
    family === 'anthropic'
      ? ANTHROPIC_VISION_PATTERNS
      : family === 'openai'
        ? OPENAI_VISION_PATTERNS
        : GEMINI_VISION_PATTERNS;
  return patterns.some((p) => lower.includes(p));
}

/** Providers we ship with a built-in vision-capability model list. */
function isCanonicalProvider(providerName: string): boolean {
  return providerName === 'anthropic' || providerName === 'openai' || providerName === 'gemini';
}

export interface VisionCallOptions {
  /** Configured provider name (e.g. 'anthropic', 'openai', 'gemini'). */
  readonly provider: string;
  readonly model: string;
  readonly image: { mimeType: 'image/png' | 'image/jpeg'; data: Buffer };
  readonly prompt: string;
  readonly apiKey: string;
  readonly apiBaseUrl?: string;
  /** Tracker to record token usage into. Optional for tests / unbudgeted runs. */
  readonly budgetTracker?: BudgetTracker;
}

interface VisionCallResult {
  readonly text: string;
  readonly usage: LLMUsage;
}

/**
 * Call a vision-capable model with a single image and text prompt. Routes
 * through the SDK matching the configured provider's family (Anthropic /
 * OpenAI / Gemini); unknown providers are dispatched as OpenAI-compatible
 * (matching the engine's provider-factory fallback). Records token usage
 * into the supplied `BudgetTracker` when one is given.
 */
export async function callVisionModel(opts: VisionCallOptions): Promise<string> {
  const family = visionFamily(opts.provider);

  const start = Date.now();
  const result =
    family === 'anthropic'
      ? await callAnthropicVision(opts)
      : family === 'openai'
        ? await callOpenAIVision(opts)
        : await callGeminiVision(opts);

  if (opts.budgetTracker) {
    opts.budgetTracker.record(result.usage);
  }

  logger.debug(
    {
      provider: opts.provider,
      model: opts.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      durationMs: Date.now() - start,
    },
    'vision call complete',
  );
  return result.text;
}

// ─── Per-provider implementations ────────────────────────────────────────────

async function callAnthropicVision(opts: VisionCallOptions): Promise<VisionCallResult> {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    ...(opts.apiBaseUrl ? { baseURL: opts.apiBaseUrl } : {}),
    timeout: VISION_TIMEOUT_MS,
  });
  const base64 = opts.image.data.toString('base64');

  const response = await client.messages.create({
    model: opts.model,
    max_tokens: DEFAULT_MAX_TOKENS,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: opts.image.mimeType,
              data: base64,
            },
          },
          { type: 'text', text: opts.prompt },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  const text = textBlock && 'text' in textBlock ? textBlock.text : '';
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  return {
    text,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
  };
}

async function callOpenAIVision(opts: VisionCallOptions): Promise<VisionCallResult> {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    ...(opts.apiBaseUrl ? { baseURL: opts.apiBaseUrl } : {}),
    timeout: VISION_TIMEOUT_MS,
  });
  const base64 = opts.image.data.toString('base64');
  const dataUrl = `data:${opts.image.mimeType};base64,${base64}`;

  const response = await client.chat.completions.create({
    model: opts.model,
    max_tokens: DEFAULT_MAX_TOKENS,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: opts.prompt },
        ],
      },
    ],
  });

  const text = response.choices[0]?.message.content ?? '';
  const inputTokens = response.usage?.prompt_tokens ?? 0;
  const outputTokens = response.usage?.completion_tokens ?? 0;
  return {
    text,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: response.usage?.total_tokens ?? inputTokens + outputTokens,
    },
  };
}

async function callGeminiVision(opts: VisionCallOptions): Promise<VisionCallResult> {
  const client = new GoogleGenAI({
    apiKey: opts.apiKey,
    ...(opts.apiBaseUrl ? { httpOptions: { baseUrl: opts.apiBaseUrl } } : {}),
  });
  const base64 = opts.image.data.toString('base64');

  const response = await client.models.generateContent({
    model: opts.model,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: opts.image.mimeType, data: base64 } },
          { text: opts.prompt },
        ],
      },
    ],
    config: { maxOutputTokens: DEFAULT_MAX_TOKENS },
  });

  const text = response.text ?? '';
  const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
  return {
    text,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
  };
}
