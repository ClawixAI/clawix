/**
 * Provider factory — creates the correct LLM provider by name.
 */

import type { LLMProvider } from '@clawix/shared';

import { AnthropicProvider } from './anthropic-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { OpenAIResponsesProvider } from './openai-responses-provider.js';
import { isCodexModel } from './openai-responses-utils.js';

const ZAI_CODING_DEFAULT_BASE_URL = 'https://api.z.ai/api/coding/paas/v4';

/**
 * Instantiate an {@link LLMProvider} by provider name.
 *
 * Known providers: `'anthropic'`, `'openai'`, `'zai-coding'`.
 * Any other name is treated as an OpenAI-compatible custom provider
 * and requires a `baseURL`.
 *
 * When `model` is provided and matches a Codex or GPT-5.x pattern,
 * the OpenAI Responses API provider is used instead of the Chat
 * Completions provider.
 */
export function createProvider(
  providerName: string,
  apiKey: string,
  baseURL?: string,
  model?: string,
): LLMProvider {
  switch (providerName) {
    case 'anthropic':
      return new AnthropicProvider(apiKey, baseURL);

    case 'openai':
      if (model && isCodexModel(model)) {
        return new OpenAIResponsesProvider(apiKey, baseURL);
      }
      return new OpenAIProvider(apiKey, baseURL);

    case 'zai-coding':
      return new OpenAIProvider(apiKey, baseURL ?? ZAI_CODING_DEFAULT_BASE_URL);

    default:
      if (!baseURL) {
        throw new Error(`baseURL is required for provider "${providerName}"`);
      }
      return new OpenAIProvider(apiKey, baseURL);
  }
}
