/**
 * Web fetch tool — fetches a URL and extracts readable content as markdown.
 *
 * Executes on the host (not in the container). Validates URLs for SSRF
 * safety before making any HTTP request. Uses undici with DNS pinning
 * to prevent DNS rebinding attacks. Extracts content via the
 * readability + turndown pipeline for HTML, pretty-prints JSON,
 * and passes through plain text.
 */
import { Agent, fetch as undiciFetch } from 'undici';

import { createLogger } from '@clawix/shared';

import type { Tool, ToolResult } from '../../tool.js';
import { validateUrl } from './ssrf-protection.js';
import { extractContent } from './content-extractor.js';

const logger = createLogger('engine:tools:web:fetch');

const DEFAULT_MAX_CHARS = 50_000;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_REDIRECTS = 5;
const USER_AGENT = 'Clawix/1.0';

/**
 * Create a web_fetch tool that fetches URLs with SSRF protection and content extraction.
 */
export function createWebFetchTool(): Tool {
  return {
    name: 'web_fetch',
    description:
      'Fetch a URL and extract readable content as markdown. Use for articles, docs, or web pages.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to fetch',
        },
        maxChars: {
          type: 'integer',
          description: 'Maximum characters to return (default 50000)',
          minimum: 100,
        },
      },
      required: ['url'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const url = params['url'] as string;
      const maxChars = (params['maxChars'] as number | undefined) ?? DEFAULT_MAX_CHARS;

      logger.info({ url, maxChars }, 'web_fetch invoked');

      try {
        // Step 1: SSRF validation — resolves DNS and checks IP ranges
        const validated = await validateUrl(url);

        // Step 2: Create a DNS-pinned undici Agent to prevent DNS rebinding.
        // The Agent's connect.lookup returns the pre-validated IP, ensuring
        // the actual TCP connection goes to the same IP that passed SSRF checks.
        const dispatcher = new Agent({
          connect: {
            lookup: (_hostname, _options, callback) => {
              callback(null, [
                { address: validated.resolvedIp, family: validated.resolvedIp.includes(':') ? 6 : 4 },
              ]);
            },
          },
        });

        // Step 3: Fetch with timeout, DNS pinning, and redirect limit
        const controller = new AbortController();
        const timeout = setTimeout(() => {
          controller.abort();
        }, FETCH_TIMEOUT_MS);

        let response: Awaited<ReturnType<typeof undiciFetch>>;
        try {
          response = await undiciFetch(url, {
            signal: controller.signal,
            headers: {
              'User-Agent': USER_AGENT,
            },
            dispatcher,
            redirect: 'follow',
            maxRedirections: MAX_REDIRECTS,
          } as Parameters<typeof undiciFetch>[1]);
        } finally {
          clearTimeout(timeout);
          await dispatcher.close();
        }

        if (!response.ok) {
          return {
            output: `Fetch failed: HTTP ${response.status} for ${url}`,
            isError: true,
          };
        }

        // Step 4: Read body with streaming size enforcement
        const body = await readBodyWithLimit(response, MAX_RESPONSE_BYTES);

        // Step 5: Extract content based on content type
        const contentType = response.headers.get('content-type') ?? 'text/plain';
        const extracted = extractContent(body, contentType, maxChars);

        // Step 6: Format output
        const titleLine = extracted.title
          ? `Title: ${extracted.title}\nURL: ${url}\n\n`
          : `URL: ${url}\n\n`;
        const output = titleLine + extracted.content;

        logger.info(
          {
            url,
            contentType,
            contentLength: body.length,
            extractedLength: extracted.content.length,
          },
          'web_fetch completed',
        );

        return { output, isError: false };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ url, error: message }, 'web_fetch failed');
        return { output: `Fetch failed: ${message}`, isError: true };
      }
    },
  };
}

/**
 * Read response body as text, aborting if size exceeds limit.
 *
 * Uses the response body stream to enforce size at the byte level,
 * preventing memory exhaustion from large responses.
 */
async function readBodyWithLimit(
  response: Awaited<ReturnType<typeof undiciFetch>>,
  maxBytes: number,
): Promise<string> {
  // If Content-Length is known and exceeds limit, fail fast
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error(`Response too large: ${contentLength} bytes exceeds ${maxBytes} byte limit`);
  }

  // Stream the body and enforce byte limit
  const body = response.body as ReadableStream<Uint8Array> | null;
  if (!body) {
    throw new Error('Response body is not readable');
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let readResult = await reader.read();

  while (!readResult.done) {
    const chunk = readResult.value;
    totalBytes += chunk.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error(`Response too large: exceeded ${maxBytes} byte limit`);
    }

    chunks.push(chunk);
    readResult = await reader.read();
  }

  const decoder = new TextDecoder();
  return chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('') + decoder.decode();
}
