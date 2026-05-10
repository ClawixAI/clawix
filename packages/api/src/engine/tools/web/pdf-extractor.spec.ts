// packages/api/src/engine/tools/web/pdf-extractor.spec.ts
import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { extractPdf } from './pdf-extractor.js';

/** Build a tiny in-memory PDF with the given page strings. */
async function buildPdf(pages: readonly string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([300, 200]);
    page.drawText(text, { x: 20, y: 150, size: 14, font });
  }
  return await doc.save();
}

describe('extractPdf', () => {
  it('extracts text from a single-page PDF', async () => {
    const bytes = await buildPdf(['Hello, World!']);

    const result = await extractPdf(bytes, 50_000);

    expect(result.title).toBeNull();
    expect(result.content).toContain('Hello, World!');
  });

  it('joins text from multi-page PDFs with double newlines', async () => {
    const bytes = await buildPdf(['Page one text', 'Page two text', 'Page three text']);

    const result = await extractPdf(bytes, 50_000);

    expect(result.content).toContain('Page one text');
    expect(result.content).toContain('Page two text');
    expect(result.content).toContain('Page three text');
    const oneIdx = result.content.indexOf('Page one text');
    const twoIdx = result.content.indexOf('Page two text');
    expect(oneIdx).toBeGreaterThan(-1);
    expect(twoIdx).toBeGreaterThan(oneIdx);
  });

  it('respects maxChars by truncating output', async () => {
    const longText = 'A'.repeat(500);
    const bytes = await buildPdf([longText]);

    const result = await extractPdf(bytes, 100);

    expect(result.content.length).toBeLessThanOrEqual(100);
  });

  it('returns a friendly error message for corrupted bytes', async () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);

    const result = await extractPdf(garbage, 50_000);

    expect(result.content).toMatch(/PDF content could not be extracted/i);
  });

  it('returns a friendly error message for an encrypted PDF', async () => {
    const encrypted = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj trailer<</Encrypt 1 0 R/Root 1 0 R>>%%EOF',
      'utf-8',
    );

    const result = await extractPdf(new Uint8Array(encrypted), 50_000);

    expect(result.content).toMatch(/PDF content could not be extracted/i);
  });

  it('extracts title from PDF metadata when present', async () => {
    const doc = await PDFDocument.create();
    doc.setTitle('Test Document Title');
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([300, 200]);
    page.drawText('Body text', { x: 20, y: 150, size: 14, font });
    const bytes = await doc.save();

    const result = await extractPdf(bytes, 50_000);

    expect(result.title).toBe('Test Document Title');
    expect(result.content).toContain('Body text');
  });

  it('returns empty content for a PDF with no pages', async () => {
    const doc = await PDFDocument.create();
    const bytes = await doc.save();

    const result = await extractPdf(bytes, 50_000);

    expect(result.content).toBe('');
    expect(result.title).toBeNull();
  });
});
