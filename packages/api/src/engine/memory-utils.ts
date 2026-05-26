/**
 * Shared helper for extracting text from JSON content blobs.
 */

/** Extract the text string from a JSON content value (string, {text}, or JSON.stringify fallback). */
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content !== null && typeof content === 'object' && !Array.isArray(content)) {
    const obj = content as Record<string, unknown>;
    if (typeof obj['text'] === 'string') return obj['text'];
  }
  return JSON.stringify(content);
}
