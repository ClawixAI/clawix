import { describe, expect, it, vi, beforeEach } from 'vitest';

import { createWebFetchTool } from '../tools/web/web-fetch.js';

// Mock ssrf-protection
vi.mock('../tools/web/ssrf-protection.js', () => ({
  validateUrl: vi.fn().mockResolvedValue({
    hostname: 'example.com',
    resolvedIp: '93.184.216.34',
    port: 443,
    pathname: '/',
    protocol: 'https:',
  }),
}));

// Mock undici — mock fetch and Agent
const { mockUndiciFetch } = vi.hoisted(() => ({
  mockUndiciFetch: vi.fn(),
}));
vi.mock('undici', () => ({
  fetch: mockUndiciFetch,
  Agent: vi.fn().mockImplementation(() => ({
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { validateUrl } from '../tools/web/ssrf-protection.js';

const mockValidateUrl = validateUrl as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockValidateUrl.mockReset().mockResolvedValue({
    hostname: 'example.com',
    resolvedIp: '93.184.216.34',
    port: 443,
    pathname: '/',
    protocol: 'https:',
  });
  mockUndiciFetch.mockReset();
});

/** Helper to create a mock undici fetch response with a readable body stream. */
function makeFetchResponse(body: string, contentType = 'text/html', status = 200) {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(body);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': contentType }),
    body: stream,
    redirected: false,
  };
}

describe('web_fetch tool — metadata', () => {
  it('has name "web_fetch"', () => {
    const tool = createWebFetchTool();
    expect(tool.name).toBe('web_fetch');
  });

  it('requires url parameter', () => {
    const tool = createWebFetchTool();
    expect(tool.parameters.required).toContain('url');
  });
});

describe('web_fetch tool — execute', () => {
  it('fetches and extracts HTML content', async () => {
    mockUndiciFetch.mockResolvedValue(
      makeFetchResponse(
        '<html><head><title>Test</title></head><body><article><p>Hello world</p></article></body></html>',
        'text/html',
      ),
    );

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com' });

    expect(result.isError).toBe(false);
    expect(result.output).toContain('Hello world');
    expect(mockValidateUrl).toHaveBeenCalledWith('https://example.com');
  });

  it('fetches and pretty-prints JSON content', async () => {
    mockUndiciFetch.mockResolvedValue(makeFetchResponse('{"key":"value"}', 'application/json'));

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://api.example.com/data' });

    expect(result.isError).toBe(false);
    expect(result.output).toContain('"key": "value"');
  });

  it('passes through plain text', async () => {
    mockUndiciFetch.mockResolvedValue(makeFetchResponse('Plain text content', 'text/plain'));

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com/file.txt' });

    expect(result.isError).toBe(false);
    expect(result.output).toContain('Plain text content');
  });

  it('returns error when SSRF validation fails', async () => {
    mockValidateUrl.mockRejectedValue(new Error('URL resolves to blocked IP range (127.0.0.1)'));

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'http://localhost/admin' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('blocked');
  });

  it('returns error on HTTP error status', async () => {
    mockUndiciFetch.mockResolvedValue(makeFetchResponse('Not Found', 'text/plain', 404));

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com/missing' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('404');
  });

  it('returns error on fetch failure', async () => {
    mockUndiciFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://down.example.com' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('ECONNREFUSED');
  });

  it('respects maxChars parameter', async () => {
    mockUndiciFetch.mockResolvedValue(makeFetchResponse('x'.repeat(1000), 'text/plain'));

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com', maxChars: 100 });

    expect(result.isError).toBe(false);
    // Output includes URL header, so content portion should be truncated
    expect(result.output.length).toBeLessThan(300);
  });

  it('aborts when body stream stalls beyond fetch timeout', async () => {
    vi.useFakeTimers();

    try {
      // Body stream that never enqueues data and never closes — simulates
      // a server that returns headers fast (e.g. CNN /live-news/) but then
      // hangs the body. Without timeout coverage on the body read, this
      // would hang the agent until the cron wrapper kills it 5 minutes later.
      const stream = new ReadableStream<Uint8Array>({
        pull() {
          // intentionally never resolves
        },
      });

      mockUndiciFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        body: stream,
        redirected: false,
      });

      const tool = createWebFetchTool();
      const promise = tool.execute({ url: 'https://example.com/slow-body' });

      // Advance fake clock past FETCH_TIMEOUT_MS (30s)
      await vi.advanceTimersByTimeAsync(31_000);

      const result = await promise;
      expect(result.isError).toBe(true);
      expect(result.output.toLowerCase()).toMatch(/abort/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts when response body exceeds size limit', async () => {
    // Create a stream that emits chunks exceeding the 10MB limit
    const chunkSize = 1024 * 1024; // 1MB per chunk
    let chunkCount = 0;
    const stream = new ReadableStream({
      pull(controller) {
        chunkCount++;
        if (chunkCount <= 12) {
          // 12 chunks × 1MB = 12MB > 10MB limit
          controller.enqueue(new Uint8Array(chunkSize));
        } else {
          controller.close();
        }
      },
    });

    mockUndiciFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain' }),
      body: stream,
      redirected: false,
    });

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com/huge' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('too large');
  });
});
