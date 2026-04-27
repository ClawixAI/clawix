/**
 * Google Gemini LLM provider — wraps `@google/genai` and normalizes responses
 * to the shared {@link LLMProvider} interface.
 *
 * Key differences from Anthropic and OpenAI:
 * - Roles are `user` / `model` (not `assistant`)
 * - System prompt is `systemInstruction`, not a regular message
 * - Tool calls/results are encoded as `parts` inside content turns
 * - Per-call `thoughtSignature` must be echoed back to preserve the model's
 *   reasoning chain across multi-turn tool calling
 */

import { GoogleGenAI } from '@google/genai';
import {
  createLogger,
  type ChatMessage,
  type ChatOptions,
  type LLMProvider,
  type LLMResponse,
} from '@clawix/shared';

import { parseGeminiResponse, toGeminiRequest, toGeminiTools } from './gemini-utils.js';

const DEFAULT_MODEL = 'gemini-3-flash-preview';

const log = createLogger('engine:gemini');

/**
 * Race a promise against an abort signal. Resolves with the promise's value
 * unless the signal fires first, in which case it rejects with an AbortError.
 */
async function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throw new Error('Request aborted');
  }
  let abortHandler: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    abortHandler = () => reject(new Error('Request aborted'));
    signal.addEventListener('abort', abortHandler, { once: true });
  });
  // Prevent unhandled rejection if the call resolves first.
  abortPromise.catch(() => {});
  try {
    return await Promise.race([promise, abortPromise]);
  } finally {
    if (abortHandler) {
      signal.removeEventListener('abort', abortHandler);
    }
  }
}

function normalizeGeminiError(err: unknown): Error {
  if (!(err instanceof Error)) {
    return new Error(`Gemini request failed: ${String(err)}`);
  }
  const status = (err as { status?: number }).status;
  if (status === 401) {
    return new Error(`Gemini auth failed: ${err.message}`);
  }
  if (status === 429) {
    return new Error(`Gemini rate limit: ${err.message}`);
  }
  if (status === 400) {
    return new Error(`Gemini request rejected: ${err.message}`);
  }
  // Surface undici-style network failures: TypeError("fetch failed") with the
  // real diagnostic on `cause` (e.g. ENOTFOUND, ECONNREFUSED, UND_ERR_CONNECT_TIMEOUT).
  // Without this, callers see only the useless "fetch failed" string.
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code;
    const detail = code ?? cause.message;
    return new Error(`Gemini network error: ${err.message} (${detail})`, { cause });
  }
  return err;
}

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  private readonly client: GoogleGenAI;

  constructor(apiKey: string, baseURL?: string) {
    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }
    this.client = new GoogleGenAI({
      apiKey,
      ...(baseURL ? { httpOptions: { baseUrl: baseURL } } : {}),
    });
  }

  async chat(messages: readonly ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const model = options?.model ?? DEFAULT_MODEL;
    const { systemInstruction, contents } = toGeminiRequest(messages);
    const tools =
      options?.tools && options.tools.length > 0 ? toGeminiTools(options.tools) : undefined;

    log.debug({ model, messageCount: messages.length }, 'Sending chat request');

    const config: Record<string, unknown> = {
      ...(systemInstruction ? { systemInstruction } : {}),
      ...(tools ? { tools } : {}),
      ...(options?.settings?.maxTokens !== undefined
        ? { maxOutputTokens: options.settings.maxTokens }
        : {}),
      ...(options?.settings?.temperature !== undefined
        ? { temperature: options.settings.temperature }
        : {}),
      ...(options?.settings?.topP !== undefined ? { topP: options.settings.topP } : {}),
      ...(options?.settings?.stopSequences
        ? { stopSequences: options.settings.stopSequences as string[] }
        : {}),
    };

    let resp: unknown;
    try {
      // The @google/genai SDK does not expose an AbortSignal hook on
      // generateContent. Race the call against the abort signal so the
      // caller is unblocked immediately when an abort fires; the underlying
      // HTTPS request will be abandoned by the runtime.
      const callPromise = this.client.models.generateContent({
        model,
        contents: contents as never,
        config,
      });
      resp = options?.abortSignal
        ? await raceWithAbort(callPromise, options.abortSignal)
        : await callPromise;
    } catch (err) {
      throw normalizeGeminiError(err);
    }
    const result = parseGeminiResponse(resp as Parameters<typeof parseGeminiResponse>[0]);

    log.debug(
      {
        model,
        finishReason: result.finishReason,
        toolCallCount: result.toolCalls.length,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      },
      'Received chat response',
    );

    return result;
  }
}
