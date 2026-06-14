import { describe, it, expect } from 'vitest';
import { groupToolsByTier } from '../group-by-tier';
import type { McpToolDto, McpToolTiers } from '@/lib/mcp';

const tool = (id: string, name: string): McpToolDto => ({
  id,
  name,
  description: '',
  mcpConnectionId: 'conn',
  inputSchema: {},
  scanFlagged: false,
  scanReason: null,
  createdAt: '',
});

const tools: McpToolDto[] = [
  tool('1', 'search'),
  tool('2', 'create_issue'),
  tool('3', 'delete_repo'),
  tool('4', 'brand_new'),
];

describe('groupToolsByTier', () => {
  it('buckets tools by tier; unknown catalog tools → other with isNew', () => {
    const tiers: McpToolTiers = {
      recommended: ['search'],
      optional: ['create_issue'],
      off: ['delete_repo'],
    };
    const g = groupToolsByTier(tools, tiers);
    expect(g.recommended.map((t) => t.name)).toEqual(['search']);
    expect(g.optional.map((t) => t.name)).toEqual(['create_issue']);
    // off + tools absent from tiers both fall to "other"; absent ones flagged new
    expect(g.other.find((t) => t.name === 'delete_repo')?.isNew).toBe(false);
    expect(g.other.find((t) => t.name === 'brand_new')?.isNew).toBe(true);
  });

  it('no tiers → all tools in other, none new', () => {
    const g = groupToolsByTier(tools, null);
    expect(g.recommended).toEqual([]);
    expect(g.optional).toEqual([]);
    expect(g.other).toHaveLength(4);
    expect(g.other.every((t) => !t.isNew)).toBe(true);
  });
});
