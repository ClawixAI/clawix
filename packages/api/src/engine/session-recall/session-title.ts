/** Greeting tokens that should not become a session title. Lowercased. */
const GREETINGS = new Set([
  'hi',
  'hello',
  'hey',
  'yo',
  'hiya',
  'sup',
  'hallo',
  '嗨',
  '你好',
  '您好',
  '哈囉',
  '哈罗',
  'おはよう',
  'こんにちは',
]);

/** Below this many code points a message is treated as too thin to be a title. */
const MIN_SUBSTANTIVE_CODEPOINTS = 6;

/** A greeting-only message has at most this many whitespace-separated words... */
const MAX_GREETING_WORDS = 3;
/** ...with each trailing filler word no longer than this many code points. */
const MAX_GREETING_FILLER_CODEPOINTS = 8;

/** Segmenter for counting and slicing grapheme clusters (handles emoji + CJK). */
const segmenter = new Intl.Segmenter();

/** Returns the grapheme segments of s as an array of strings. */
function graphemes(s: string): string[] {
  return Array.from(segmenter.segment(s), (seg) => seg.segment);
}

/** Clamp on grapheme clusters so surrogates and emoji are never split. */
function clampCodePoints(s: string, max: number): string {
  const segs = graphemes(s);
  if (segs.length <= max) return s;
  return segs.slice(0, max).join('');
}

/** For Latin-ish text, trim a trailing partial word at a space boundary. */
function trimToWordBoundary(s: string): string {
  const lastSpace = s.lastIndexOf(' ');
  // No usable interior space → just strip surrounding whitespace.
  if (lastSpace <= 0) return s.trim();
  // Trim back to the last word boundary.
  return s.slice(0, lastSpace).trim();
}

/**
 * Returns true if the message is greeting-only (e.g. "hi", "hello there").
 * A message is greeting-only when its first whitespace-separated token is a
 * known greeting and the full message is short enough to be purely social (≤ 3
 * words, none longer than 8 characters).
 */
function isGreetingOnly(lower: string): boolean {
  if (GREETINGS.has(lower)) return true;
  const words = lower.split(/\s+/);
  if (words.length > MAX_GREETING_WORDS) return false;
  const first = words[0] ?? '';
  if (!GREETINGS.has(first)) return false;
  // All remaining words must also be short filler.
  return words.slice(1).every((w) => graphemes(w).length <= MAX_GREETING_FILLER_CODEPOINTS);
}

function isSubstantive(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (isGreetingOnly(lower)) return false;
  return graphemes(trimmed).length >= MIN_SUBSTANTIVE_CODEPOINTS;
}

function clampTitle(raw: string, maxChars: number): string {
  const trimmed = raw.trim();
  const clamped = clampCodePoints(trimmed, maxChars);
  if (clamped === trimmed) return clamped;
  // We truncated — for Latin scripts, avoid a mid-word cut.
  return /\s/.test(clamped) ? trimToWordBoundary(clamped) : clamped;
}

export interface DeriveTitleParams {
  readonly storedTopic: string | null;
  readonly firstUserMessages: readonly string[]; // first ≤3 user messages, in order
  readonly createdAt: Date;
  readonly maxChars?: number; // default 100 (code points)
}

/**
 * Human-readable title for a conversation, used by Recent Sessions and search
 * result labels. Prefers an explicit topic; else the first substantive user
 * message (skipping greetings); else a dated fallback.
 */
export function deriveSessionTitle(params: DeriveTitleParams): string {
  const maxChars = params.maxChars ?? 100;

  if (params.storedTopic && params.storedTopic.trim()) {
    return clampTitle(params.storedTopic, maxChars);
  }

  for (const msg of params.firstUserMessages.slice(0, 3)) {
    if (isSubstantive(msg)) return clampTitle(msg, maxChars);
  }

  // Dated fallback (UTC date — a descriptive label, not timezone-sensitive).
  const date = params.createdAt.toISOString().slice(0, 10);
  return `Session — ${date}`;
}
