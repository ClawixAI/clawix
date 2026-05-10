// packages/api/src/engine/tools/web/web-fetch.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { createWebFetchTool } from './web-fetch.js';

// Mock ssrf-protection so we never attempt real DNS resolution.
vi.mock('./ssrf-protection.js', () => ({
  validateUrl: vi.fn().mockResolvedValue({
    hostname: 'example.com',
    resolvedIp: '93.184.216.34',
    port: 443,
    pathname: '/',
    protocol: 'https:',
  }),
}));

// Mock undici — same vi.hoisted pattern used in the existing web-fetch.test.ts.
const { mockUndiciFetch } = vi.hoisted(() => ({
  mockUndiciFetch: vi.fn(),
}));
vi.mock('undici', () => ({
  fetch: mockUndiciFetch,
  Agent: vi.fn().mockImplementation(() => ({
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

/** Build a tiny in-memory PDF with the given text on a single page. */
async function buildPdf(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 200]);
  page.drawText(text, { x: 20, y: 150, size: 14, font });
  return await doc.save();
}

/** Create a mock fetch response backed by a Uint8Array body stream. */
function makeBinaryFetchResponse(body: Uint8Array, contentType: string, status = 200) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(body);
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

beforeEach(() => {
  mockUndiciFetch.mockReset();
});

describe('web_fetch — PDF routing', () => {
  it('routes PDF responses to extractPdf when Content-Type is application/pdf', async () => {
    const pdfBytes = await buildPdf('Hello PDF');

    mockUndiciFetch.mockResolvedValue(makeBinaryFetchResponse(pdfBytes, 'application/pdf'));

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com/file' });

    expect(result.isError).toBe(false);
    expect(result.output).toContain('Hello PDF');
  });

  it('routes PDF responses when URL ends in .pdf even with octet-stream Content-Type', async () => {
    const pdfBytes = await buildPdf('Hello PDF');

    mockUndiciFetch.mockResolvedValue(
      makeBinaryFetchResponse(pdfBytes, 'application/octet-stream'),
    );

    const tool = createWebFetchTool();
    // URL pathname ends in .pdf — should trigger the PDF branch regardless of Content-Type.
    const result = await tool.execute({ url: 'https://example.com/document.pdf' });

    expect(result.isError).toBe(false);
    expect(result.output).toContain('Hello PDF');
  });

  it('treats .pdf URL as PDF even when Content-Type is text/html (URL suffix triggers PDF mode)', async () => {
    // isPdfResponse uses OR semantics: Content-Type === application/pdf OR URL ends in .pdf.
    // A .pdf URL always triggers PDF mode even if the server sends text/html.
    const pdfBytes = await buildPdf('Hello PDF');

    mockUndiciFetch.mockResolvedValue(makeBinaryFetchResponse(pdfBytes, 'text/html'));

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com/report.pdf' });

    expect(result.isError).toBe(false);
    expect(result.output).toContain('Hello PDF');
  });

  it('triggers PDF mode for application/pdf with parameters (e.g. charset)', async () => {
    // isPdfResponse strips the parameters from Content-Type before comparing,
    // so "application/pdf; charset=utf-8" must still trigger PDF mode.
    const pdfBytes = await buildPdf('Hello PDF');

    mockUndiciFetch.mockResolvedValue(
      makeBinaryFetchResponse(pdfBytes, 'application/pdf; charset=utf-8'),
    );

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com/file' });

    expect(result.isError).toBe(false);
    expect(result.output).toContain('Hello PDF');
  });

  it('triggers PDF mode for uppercase .PDF URL suffix', async () => {
    // isPdfResponse lowercases the pathname, so ".PDF" must match as well as ".pdf".
    const pdfBytes = await buildPdf('Hello PDF');

    mockUndiciFetch.mockResolvedValue(
      makeBinaryFetchResponse(pdfBytes, 'application/octet-stream'),
    );

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com/Document.PDF' });

    expect(result.isError).toBe(false);
    expect(result.output).toContain('Hello PDF');
  });
});
