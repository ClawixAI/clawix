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
import { extractPdf } from './pdf-extractor.js';

const logger = createLogger('engine:tools:web:fetch');

const DEFAULT_MAX_CHARS = 50_000;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_REDIRECTS = 5;
const USER_AGENT = 'Clawix/1.0';

/** True when the URL or Content-Type indicates a PDF. */
function isPdfResponse(url: string, contentType: string): boolean {
  const type = (contentType.split(';')[0] ?? contentType).trim().toLowerCase();
  if (type === 'application/pdf') return true;
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith('.pdf');
  } catch {
    return false;
  }
}

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
                {
                  address: validated.resolvedIp,
                  family: validated.resolvedIp.includes(':') ? 6 : 4,
                },
              ]);
            },
          },
        });

        // Step 3: Fetch with timeout, DNS pinning, and redirect limit.
        // The same controller covers both the request/headers phase AND the
        // body-read phase — slow-streaming endpoints (live-news pages, SSE,
        // long-poll) can return headers fast but stall the body, so the
        // timeout must remain armed until the body has been fully read.
        const controller = new AbortController();
        const timeout = setTimeout(() => {
          controller.abort();
        }, FETCH_TIMEOUT_MS);

        try {
          const response = await undiciFetch(url, {
            signal: controller.signal,
            headers: {
              'User-Agent': USER_AGENT,
            },
            dispatcher,
            redirect: 'follow',
            maxRedirections: MAX_REDIRECTS,
          } as Parameters<typeof undiciFetch>[1]);

          if (!response.ok) {
            return {
              output: `Fetch failed: HTTP ${response.status} for ${url}`,
              isError: true,
            };
          }

          // Step 4: Read body as raw bytes with streaming size enforcement.
          const bytes = await readBodyBytes(response, MAX_RESPONSE_BYTES, controller.signal);

          // Step 5: Extract content based on whether this is a PDF.
          // Capture byteLength before extractPdf — pdfjs-dist transfers (detaches)
          // the underlying ArrayBuffer, which zeros out bytes.byteLength after the call.
          const contentType = response.headers.get('content-type') ?? 'text/plain';
          const isPdf = isPdfResponse(url, contentType);
          const contentLength = bytes.byteLength;
          const extracted = isPdf
            ? await extractPdf(bytes, maxChars)
            : extractContent(bytesToText(bytes), contentType, maxChars);

          // Step 6: Format output
          const titleLine = extracted.title
            ? `Title: ${extracted.title}\nURL: ${url}\n\n`
            : `URL: ${url}\n\n`;
          const output = titleLine + extracted.content;

          logger.info(
            {
              url,
              contentType,
              isPdf,
              contentLength,
              extractedLength: extracted.content.length,
            },
            'web_fetch completed',
          );

          return { output, isError: false };
        } finally {
          clearTimeout(timeout);
          await dispatcher.close();
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ url, error: message }, 'web_fetch failed');
        return { output: `Fetch failed: ${message}`, isError: true };
      }
    },
  };
}

/**
 * Read response body as raw bytes, aborting if size exceeds limit.
 *
 * Returns a Uint8Array so the caller can decide whether to decode as text
 * (HTML/JSON/plain) or pass through as binary (PDF).
 */
async function readBodyBytes(
  response: Awaited<ReturnType<typeof undiciFetch>>,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error(`Response too large: ${contentLength} bytes exceeds ${maxBytes} byte limit`);
  }

  const body = response.body as ReadableStream<Uint8Array> | null;
  if (!body) {
    throw new Error('Response body is not readable');
  }

  const reader = body.getReader();

  let abortHandler: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new Error('Body read aborted'));
      return;
    }
    abortHandler = () => reject(new Error('Body read aborted'));
    signal.addEventListener('abort', abortHandler);
  });
  abortPromise.catch(() => {});

  try {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    // Race each reader.read() against the abort signal so a server that sends
    // headers fast and then stalls the body cannot pin the loop indefinitely.
    let readResult = await Promise.race([reader.read(), abortPromise]);

    while (!readResult.done) {
      const chunk = readResult.value;
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error(`Response too large: exceeded ${maxBytes} byte limit`);
      }
      chunks.push(chunk);
      readResult = await Promise.race([reader.read(), abortPromise]);
    }

    // Concatenate chunks into a single Uint8Array.
    const out = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  } finally {
    if (abortHandler) {
      signal.removeEventListener('abort', abortHandler);
    }
    // Always release the underlying connection — important when an abort
    // unblocks the read() race while the stream is still open.
    reader.cancel().catch(() => {});
  }
}

/** Decode a Uint8Array as UTF-8 text. */
function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
