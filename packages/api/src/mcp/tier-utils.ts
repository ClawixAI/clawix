import type { McpToolTiers } from '@clawix/shared';

interface RawTiers {
  recommended?: unknown;
  optional?: unknown;
  off?: unknown;
}

/** Tolerantly parse a model's JSON tier output (handles fences / surrounding prose). */
export function parseTiersJson(content: string | null): RawTiers | null {
  if (!content) return null;
  const fenced = content.replace(/```(?:json)?/gi, '').trim();
  const candidates = [fenced];
  const match = /\{[\s\S]*\}/.exec(fenced);
  if (match) candidates.push(match[0]);
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as unknown;
      if (parsed && typeof parsed === 'object') return parsed as RawTiers;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Validate raw tiers against the real catalog:
 * - drop names not in the catalog
 * - precedence recommended > optional > off on duplicates
 * - any catalog tool the model omitted falls to `off`
 * Result: the three arrays partition the catalog exactly.
 */
export function normalizeTiers(
  raw: RawTiers | null,
  catalogNames: readonly string[],
): McpToolTiers {
  const valid = new Set(catalogNames);
  const seen = new Set<string>();
  const take = (names: string[]): string[] => {
    const out: string[] = [];
    for (const n of names) {
      if (valid.has(n) && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out;
  };
  const recommended = take(asStringArray(raw?.recommended));
  const optional = take(asStringArray(raw?.optional));
  const off = take(asStringArray(raw?.off));
  for (const n of catalogNames) {
    if (!seen.has(n)) off.push(n);
  }
  return { recommended, optional, off };
}
