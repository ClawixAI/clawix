/**
 * Telegram MarkdownV2 formatter.
 *
 * Converts standard markdown to Telegram's MarkdownV2 format, which has strict
 * escaping rules. All special characters outside formatting constructs must be
 * escaped with a backslash.
 *
 * Reference: https://core.telegram.org/bots/api#markdownv2-style
 */

/**
 * Characters that MUST be escaped in plain text outside any formatting.
 * Ordered so that backslash is first (avoid double-escaping our own escapes).
 */
const PLAIN_TEXT_SPECIAL_CHARS = /[_*[\]()~`>#+=|{}.!\-\\$]/g;

/**
 * Characters that must be escaped INSIDE inline code spans and code blocks.
 * Inside code constructs only ` and \ need escaping.
 */
const CODE_SPECIAL_CHARS = /[`\\]/g;

/** Escape special characters inside a code context (inline code / code block). */
function escapeCodeContent(text: string): string {
  return text.replace(CODE_SPECIAL_CHARS, (ch) => `\\${ch}`);
}

/** Escape special characters in plain (non-code) text, after bold conversion. */
function escapePlainText(text: string): string {
  return text.replace(PLAIN_TEXT_SPECIAL_CHARS, (ch) => `\\${ch}`);
}

/**
 * Convert **bold** markers to Telegram's *bold* and preserve _italic_, then
 * escape all remaining special characters in the resulting plain text.
 *
 * We process **bold** first (before escaping asterisks) so the conversion is
 * clean. After that, all remaining `*` chars are escaped.
 */
function processPlainSegment(text: string): string {
  // Replace **bold** with a placeholder, escape everything, then restore bold.
  // We use a two-pass approach to avoid escaping the asterisks we introduce.
  const boldParts: string[] = [];
  const withBoldRemoved = text.replace(/\*\*(.+?)\*\*/gs, (_match, inner: string) => {
    boldParts.push(inner);
    return `\x00BOLD${boldParts.length - 1}\x00`;
  });

  // Similarly preserve _italic_ spans.
  const italicParts: string[] = [];
  const withItalicRemoved = withBoldRemoved.replace(/_(.+?)_/gs, (_match, inner: string) => {
    italicParts.push(inner);
    return `\x00ITALIC${italicParts.length - 1}\x00`;
  });

  // Escape remaining special chars in the plain text.
  const escaped = escapePlainText(withItalicRemoved);

  // Restore italic spans — Telegram MarkdownV2 requires special chars to be
  // escaped EVERYWHERE except inside code constructs, so the content between _
  // markers must also be escaped (e.g. `_v1.0_` → `_v1\.0_`). The bracketing
  // underscores are inserted unescaped so they remain valid italic markers.
  const withItalicRestored = escaped.replace(/\x00ITALIC(\d+)\x00/g, (_m, idx: string) => {
    return `_${escapePlainText(italicParts[Number(idx)] ?? '')}_`;
  });

  // Restore bold spans — same rule applies inside *bold* (e.g. dashes in
  // `**hk-news-scraper**` must become `*hk\-news\-scraper*` or Telegram rejects
  // the message with "can't parse entities").
  const withBoldRestored = withItalicRestored.replace(/\x00BOLD(\d+)\x00/g, (_m, idx: string) => {
    return `*${escapePlainText(boldParts[Number(idx)] ?? '')}*`;
  });

  return withBoldRestored;
}

/**
 * Convert standard markdown to Telegram MarkdownV2 format.
 *
 * Processing order:
 * 1. Split by fenced code blocks (``` ... ```) — preserve verbatim (only escape ` and \).
 * 2. For non-code-block segments, split by inline code (` ... `) — preserve verbatim.
 * 3. For plain text segments: convert **bold** → *bold*, preserve _italic_,
 *    escape remaining special characters.
 *
 * @param input - Standard markdown string.
 * @returns MarkdownV2-formatted string safe for Telegram Bot API.
 */
export function formatMarkdownV2(input: string): string {
  if (input === '') {
    return '';
  }

  // Split by fenced code blocks. The regex captures the entire ``` ... ``` block.
  // Segment index: even = plain text, odd = fenced code block.
  const codeBlockParts = input.split(/(```[\s\S]*?```)/g);

  const processed = codeBlockParts.map((part, idx) => {
    if (idx % 2 === 1) {
      // Fenced code block — preserve the ``` delimiters verbatim; only escape
      // ` and \ inside the block content (between the opening and closing ```).
      const FENCE = '```';
      const inner = part.slice(FENCE.length, -FENCE.length);
      return FENCE + escapeCodeContent(inner) + FENCE;
    }

    // Plain text segment — split by inline code spans.
    // Segment index: even = plain text, odd = inline code span.
    const inlineCodeParts = part.split(/(`.+?`)/gs);

    return inlineCodeParts
      .map((segment, segIdx) => {
        if (segIdx % 2 === 1) {
          // Inline code span — escape content inside backticks.
          // The surrounding backticks are kept; content gets code escaping.
          const inner = segment.slice(1, -1);
          return `\`${escapeCodeContent(inner)}\``;
        }
        // Plain text — apply bold conversion and special char escaping.
        return processPlainSegment(segment);
      })
      .join('');
  });

  return processed.join('');
}
