/**
 * PDF text extraction — converts PDF bytes into joined plain text.
 *
 * Uses pdfjs-dist (Mozilla, pure-JS) to parse PDFs without native deps.
 * Returns the same ExtractedContent shape as the HTML pipeline so the
 * web_fetch tool can format both branches identically.
 *
 * Failures (corrupt / encrypted / unsupported) are surfaced as a non-error
 * result whose content explains the failure. The tool layer never throws.
 */
import { createRequire } from 'module';

import { createLogger } from '@clawix/shared';

import type { ExtractedContent } from './content-extractor.js';

// Resolve the standard_fonts/ directory shipped with pdfjs-dist once at
// module load time. pdfjs needs this path to look up metrics for standard
// fonts (Helvetica, Times-Roman, etc.) that PDFs reference without embedding.
//
// Note: pdfjs's Node.js build (NodeStandardFontDataFactory) passes the
// resulting path string directly to fs.promises.readFile(), so we must supply
// a plain filesystem path — NOT a file:// URL.
const _require = createRequire(import.meta.url);
const _pdfjsPackageJson = _require.resolve('pdfjs-dist/package.json');
const STANDARD_FONT_DATA_URL = _pdfjsPackageJson.replace(/package\.json$/, 'standard_fonts/');

const logger = createLogger('engine:tools:web:pdf');

/**
 * Extract text from a PDF byte buffer.
 *
 * @param bytes    - Raw PDF bytes.
 * @param maxChars - Maximum characters in the returned content.
 */
export async function extractPdf(bytes: Uint8Array, maxChars: number): Promise<ExtractedContent> {
  try {
    // pdfjs-dist v4 ships an ESM entrypoint. We import the legacy build to
    // avoid worker-thread setup in Node — the legacy build runs synchronously
    // on the main thread, which is fine for short documents fetched via web_fetch.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

    const loadingTask = pdfjs.getDocument({
      // Disable font and image fetching from the network — we have no
      // network in the host extractor path and pdfjs warns otherwise.
      data: bytes,
      disableFontFace: true,
      isEvalSupported: false,
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
    });

    const doc = await loadingTask.promise;
    try {
      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const textContent = await page.getTextContent();
        const text = textContent.items.map((item) => ('str' in item ? item.str : '')).join(' ');
        pages.push(text);
        page.cleanup();
      }

      const meta = await doc.getMetadata().catch(() => null);
      const rawTitle =
        meta?.info && typeof meta.info === 'object' && 'Title' in meta.info
          ? (meta.info as Record<string, unknown>)['Title']
          : null;
      const title: string | null =
        typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim() : null;

      const joined = pages.join('\n\n').trim();
      const truncated = joined.length > maxChars ? joined.slice(0, maxChars) : joined;

      return { title, content: truncated };
    } finally {
      await doc.destroy();
    }
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn({ reason }, 'PDF extraction failed');
    return {
      title: null,
      content: `[PDF content could not be extracted: ${reason}]`,
    };
  }
}
