import { relativeDay } from './relative-day.js';

export interface RecentSessionLine {
  readonly title: string;
  readonly createdAt: Date;
}

/** 1 token ≈ 4 chars (same heuristic as render-wiki-context). */
function tokensToChars(tokens: number): number {
  return tokens * 4;
}

/**
 * Render the "Recent Sessions" block for the system prompt. Pure function.
 * One line per session: `- "<title>" — <relative day>`. Lines are appended
 * until the token budget is exhausted (heading always included).
 */
export function renderRecentSessions(
  sessions: readonly RecentSessionLine[],
  now: Date,
  budgetTokens: number,
): string {
  if (sessions.length === 0) return '';

  const heading = '## Recent Sessions';
  const maxChars = tokensToChars(budgetTokens);
  const lines: string[] = [];
  let used = heading.length;

  for (const s of sessions) {
    const line = `- "${s.title}" — ${relativeDay(s.createdAt, now)}`;
    const cost = line.length + 1; // newline
    if (used + cost > maxChars) break;
    lines.push(line);
    used += cost;
  }

  if (lines.length === 0) return heading;
  return `${heading}\n\n${lines.join('\n')}`;
}
