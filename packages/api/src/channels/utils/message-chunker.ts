/**
 * Telegram message chunker.
 *
 * Splits long markdown messages into chunks that respect Telegram's 4096-character
 * per-message limit, preserving code-fence integrity across chunk boundaries.
 *
 * Design notes in docs/superpowers/plans/2026-04-23-telegram-message-chunking.md.
 */

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
export const SAFE_SPLIT_LENGTH = 3500;

const NEWLINE_WINDOW = 200;
const SPACE_WINDOW = 100;
/** Minimum chars reserved for injected closing fence (\n```) when needed. */
const FENCE_CLOSER = '\n```';

function findLastNewlineInRange(text: string, start: number, end: number, window: number): number {
  const searchStart = Math.max(end - window, start);
  for (let i = end - 1; i >= searchStart; i--) {
    if (text[i] === '\n') {
      return i;
    }
  }
  return -1;
}

function findLastSpaceInRange(text: string, start: number, end: number, window: number): number {
  const searchStart = Math.max(end - window, start);
  for (let i = end - 1; i >= searchStart; i--) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t') {
      return i;
    }
  }
  return -1;
}

/**
 * Scans text[start..end) and returns the index of the last unclosed opening ```
 * fence, or -1 if all fences are balanced.
 */
function findLastUnclosedFence(text: string, start: number, end: number): number {
  let open = false;
  let lastOpenIdx = -1;
  let i = start;
  while (i < end - 2) {
    if (text[i] === '`' && text[i + 1] === '`' && text[i + 2] === '`') {
      if (!open) {
        lastOpenIdx = i;
      }
      open = !open;
      i += 3;
      continue;
    }
    i++;
  }
  return open ? lastOpenIdx : -1;
}

/**
 * Given the absolute index of an opening ``` fence, return the language hint
 * (the token between ``` and the following newline, trimmed). Empty string if none.
 */
function extractFenceLanguage(text: string, fenceIdx: number): string {
  const afterFence = fenceIdx + 3;
  const newline = text.indexOf('\n', afterFence);
  if (newline === -1) {
    return '';
  }
  const lang = text.slice(afterFence, newline).trim();
  // Sanity cap — markdown language hints are short identifiers.
  return lang.length > 32 ? '' : lang;
}

/**
 * Find a split point within [0, hardEnd) using: newline window → space window → hard cut.
 */
function findSplitPoint(text: string, hardEnd: number): number {
  let end = findLastNewlineInRange(text, 0, hardEnd, NEWLINE_WINDOW);
  if (end <= 0) {
    end = findLastSpaceInRange(text, 0, hardEnd, SPACE_WINDOW);
  }
  if (end <= 0) {
    end = hardEnd;
  }
  return end;
}

export function splitMessage(content: string, maxLen: number): string[] {
  if (content === '') {
    return [];
  }
  if (maxLen <= 0 || content.length <= maxLen) {
    return [content];
  }

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > maxLen) {
    const end = findSplitPoint(remaining, maxLen);

    const unclosedIdx = findLastUnclosedFence(remaining, 0, end);

    if (unclosedIdx >= 0) {
      const language = extractFenceLanguage(remaining, unclosedIdx);
      // Guard against infinite loop: if end doesn't advance past the fence header,
      // the re-injected reopenHeader would recreate an identical `remaining` on the
      // next iteration. Force end past the header so we always consume body bytes.
      const headerNewline = remaining.indexOf('\n', unclosedIdx + 3);
      const headerEnd = headerNewline === -1 ? unclosedIdx + 3 + language.length : headerNewline + 1;
      const reopenLen = language ? language.length + 4 : 4; // ```lang\n  or  ```\n
      let splitEnd = end;
      if (splitEnd <= headerEnd || splitEnd <= reopenLen) {
        // Split point is inside/at the fence header — extend to a hard-cut within
        // maxLen so we actually consume body bytes beyond the reopen overhead.
        splitEnd = Math.min(maxLen, remaining.length);
      }
      const fenceCloser = FENCE_CLOSER;
      // Check if the chunk with closer fits; if not, shrink the split point.
      const raw = remaining.slice(0, splitEnd).replace(/[ \t\n\r]+$/, '');
      const withCloser = raw + fenceCloser;

      if (withCloser.length <= maxLen) {
        // Fits: emit chunk with closer, reopen next chunk.
        chunks.push(withCloser);
      } else {
        // Doesn't fit: re-split at a smaller boundary to make room for the closer.
        let shrunkEnd = findSplitPoint(remaining, maxLen - fenceCloser.length);
        // Apply the same header-progress guard to the shrunk split point.
        if (shrunkEnd <= headerEnd || shrunkEnd <= reopenLen) {
          shrunkEnd = Math.min(maxLen - fenceCloser.length, remaining.length);
        }
        const rawShrunk = remaining.slice(0, shrunkEnd).replace(/[ \t\n\r]+$/, '');
        chunks.push(rawShrunk + fenceCloser);
        const reopenHeader = language ? `\`\`\`${language}\n` : '```\n';
        remaining = reopenHeader + remaining.slice(shrunkEnd).replace(/^[ \t\n\r]+/, '');
        continue;
      }

      const reopenHeader = language ? `\`\`\`${language}\n` : '```\n';
      remaining = reopenHeader + remaining.slice(splitEnd).replace(/^[ \t\n\r]+/, '');
      continue;
    }

    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end).replace(/^[ \t\n\r]+/, '');
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}
