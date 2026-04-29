/**
 * Convert standard markdown emitted by agents into WhatsApp's text format.
 *
 * WhatsApp supports: *bold*, _italic_, ~strike~, `code`, ```block```.
 * It does not support headers, links, or **double-asterisk** bold.
 *
 * Code spans and fenced code blocks are preserved verbatim — bold/italic
 * tokens inside them must not be transformed.
 *
 * The header and bold passes produce `*Token*` — which would otherwise be
 * caught by the single-asterisk italic pass and corrupted into `_Token_`.
 * They are stashed under a separate placeholder and restored at the end.
 */

const FENCED_CODE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`\n]*`/g;
const PH_CODE_PREFIX = '\x00WAFMTC';
const PH_BOLD_PREFIX = '\x00WAFMTB';
const PH_SUFFIX = '\x00';
// eslint-disable-next-line no-control-regex -- null bytes used as stashing placeholders
const PH_CODE_REGEX = /\x00WAFMTC(\d+)\x00/g;
// eslint-disable-next-line no-control-regex -- null bytes used as stashing placeholders
const PH_BOLD_REGEX = /\x00WAFMTB(\d+)\x00/g;

function withCodePreserved(input: string, transform: (text: string) => string): string {
  const items: string[] = [];
  const stash = (match: string): string => {
    const idx = items.length;
    items.push(match);
    return `${PH_CODE_PREFIX}${idx}${PH_SUFFIX}`;
  };
  const stashed = input.replace(FENCED_CODE, stash).replace(INLINE_CODE, stash);
  const transformed = transform(stashed);
  return transformed.replace(PH_CODE_REGEX, (_m, idxStr: string) => items[Number(idxStr)] ?? '');
}

function transformBody(text: string): string {
  // The header and bold passes both produce `*Token*`. Without protection,
  // the single-asterisk italic pass below would re-match those and corrupt
  // them into `_Token_`. Stash converted tokens under PH_BOLD so the italic
  // pass only sees genuine `*italic*` runs from the original input.
  const boldItems: string[] = [];
  const stashBold = (match: string): string => {
    const idx = boldItems.length;
    boldItems.push(match);
    return `${PH_BOLD_PREFIX}${idx}${PH_SUFFIX}`;
  };

  const after = text
    // Headers (any level) -> *Header* (stashed); strip any **...** inside the body first.
    .replace(/^[ \t]*#{1,6}[ \t]+(.+?)\s*$/gm, (_m, body: string) =>
      stashBold(`*${body.replace(/\*\*([^*\n]+?)\*\*/g, '$1')}*`),
    )
    // **bold** -> *bold* (stashed)
    .replace(/\*\*([^*\n]+?)\*\*/g, (_m, body: string) => stashBold(`*${body}*`))
    // ~~strike~~ -> ~strike~ (no italic-pass conflict)
    .replace(/~~([^~\n]+?)~~/g, '~$1~')
    // *italic* -> _italic_  (now only matches genuine standalone single * runs)
    .replace(/(?<![*\w])\*([^*\n]+?)\*(?!\w)/g, '_$1_')
    // [text](url) -> text (url)
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1 ($2)');

  return after.replace(PH_BOLD_REGEX, (_m, idxStr: string) => boldItems[Number(idxStr)] ?? '');
}

export function formatWhatsAppText(input: string): string {
  if (input === '') return '';
  return withCodePreserved(input, transformBody);
}
