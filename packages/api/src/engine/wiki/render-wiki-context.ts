import type { WikiPage } from '../../generated/prisma/client.js';

export interface RenderInput {
  now: Date;
  ambientPages: readonly WikiPage[];
  schemaPage: WikiPage | null;
  indexPages: readonly WikiPage[];
  budgets: { ambient: number; schema: number; index: number };
}

/** Rough heuristic: 1 token ≈ 4 characters of text. Good enough for budgets. */
function tokensToChars(tokens: number): number {
  return tokens * 4;
}

function truncate(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(0, maxChars - 14))}\n\n[truncated]`;
}

/**
 * Render the wiki-backed context block for the system prompt.
 *
 * Pure function — no I/O, no side effects, easy to unit test.
 */
export function renderWikiContext(input: RenderInput): string {
  const parts: string[] = [];

  if (input.ambientPages.length > 0) {
    const body = input.ambientPages
      .map((p) => `### ${p.title}\n\n${p.content}`)
      .join('\n\n----\n\n');
    parts.push('## Long-term Memory\n\n' + truncate(body, tokensToChars(input.budgets.ambient)));
  }

  if (input.schemaPage) {
    parts.push(
      '## Wiki Schema\n\n' +
        truncate(input.schemaPage.content, tokensToChars(input.budgets.schema)),
    );
  }

  if (input.indexPages.length > 0) {
    const groups = groupByDomain(input.indexPages);
    const indexBody = Object.entries(groups)
      .sort(([a], [b]) => (a === '(untagged)' ? 1 : b === '(untagged)' ? -1 : a.localeCompare(b)))
      .map(([domain, pages]) => {
        const items = pages
          .map(
            (p) =>
              `- ${p.slug} — "${p.summary}"${
                p.tags.length
                  ? ` [${p.tags
                      .filter((t) => !t.startsWith('domain:'))
                      .map((t) => `#${t}`)
                      .join(' ')}]`
                  : ''
              }`,
          )
          .join('\n');
        return `### ${domain}\n${items}`;
      })
      .join('\n\n');
    parts.push('## Wiki Index\n\n' + truncate(indexBody, tokensToChars(input.budgets.index)));
  }

  return parts.join('\n\n');
}

function groupByDomain(pages: readonly WikiPage[]): Record<string, WikiPage[]> {
  const out: Record<string, WikiPage[]> = {};
  for (const p of pages) {
    const domain = p.tags.find((t) => t.startsWith('domain:')) ?? '(untagged)';
    (out[domain] ??= []).push(p);
  }
  return out;
}
