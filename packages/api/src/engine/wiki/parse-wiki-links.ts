const SLUG_RE = /^[a-z0-9_][a-z0-9_-]{0,79}$/;

/**
 * Extract unique `[[slug]]` wiki-link markers from markdown content.
 * Only slugs matching `[a-z0-9_][a-z0-9_-]{0,79}` are returned; all others
 * (empty, containing spaces, uppercase, etc.) are silently ignored.
 * Order is preserved; duplicates are deduplicated.
 */
export function parseWikiLinks(markdown: string): string[] {
  const out = new Set<string>();
  for (const match of markdown.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const captured = match[1];
    if (captured === undefined) continue;
    const candidate = captured.trim();
    if (SLUG_RE.test(candidate)) out.add(candidate);
  }
  return [...out];
}
