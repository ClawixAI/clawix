import type { McpToolDto, McpToolTiers } from '@/lib/mcp';

export interface TierTool extends McpToolDto {
  isNew: boolean;
}

export interface TierGroups {
  recommended: TierTool[];
  optional: TierTool[];
  other: TierTool[]; // off tier + any catalog tool absent from the tiers (isNew)
}

/**
 * Bucket a server's catalog by the LLM tiers. Tools absent from all tiers (e.g.
 * discovered after the last suggestion, or when there's no suggestion) land in
 * `other`; the ones absent specifically because tiers exist but don't mention
 * them are flagged `isNew`.
 */
export function groupToolsByTier(
  tools: readonly McpToolDto[],
  tiers: McpToolTiers | null,
): TierGroups {
  if (!tiers) {
    return { recommended: [], optional: [], other: tools.map((t) => ({ ...t, isNew: false })) };
  }
  const rec = new Set(tiers.recommended);
  const opt = new Set(tiers.optional);
  const off = new Set(tiers.off);
  const groups: TierGroups = { recommended: [], optional: [], other: [] };
  for (const t of tools) {
    if (rec.has(t.name)) groups.recommended.push({ ...t, isNew: false });
    else if (opt.has(t.name)) groups.optional.push({ ...t, isNew: false });
    else groups.other.push({ ...t, isNew: !off.has(t.name) });
  }
  return groups;
}
