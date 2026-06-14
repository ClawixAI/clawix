import { describe, it, expect } from 'vitest';

import { bindingsFromTiers } from '../bindings-from-tiers.js';
import type { McpServerForRun } from '../../../../db/mcp-server.repository.js';

/** Minimal server fixture; cast through unknown — only the read fields matter. */
function srv(over: {
  id?: string;
  enabled?: boolean;
  status?: string | null;
  tiers?: unknown;
  hasConnection?: boolean;
}): McpServerForRun {
  const connection =
    over.hasConnection === false
      ? []
      : [{ status: over.status ?? 'active', tiers: over.tiers ?? null, tools: [] }];
  return {
    id: over.id ?? 'srv1',
    enabled: over.enabled ?? true,
    slug: 'gh',
    connections: connection,
  } as unknown as McpServerForRun;
}

describe('bindingsFromTiers', () => {
  it('emits a binding of the recommended tools for an active connection', () => {
    const out = bindingsFromTiers([
      srv({ tiers: { recommended: ['search', 'get_me'], optional: ['x'], off: ['y'] } }),
    ]);
    expect(out.servers).toEqual([{ serverId: 'srv1', enabledTools: ['search', 'get_me'] }]);
  });

  it('skips servers with no connection', () => {
    expect(bindingsFromTiers([srv({ hasConnection: false })]).servers).toEqual([]);
  });

  it('skips connections that are not active', () => {
    expect(
      bindingsFromTiers([srv({ status: 'reauth_required', tiers: { recommended: ['a'] } })])
        .servers,
    ).toEqual([]);
  });

  it('skips disabled servers', () => {
    expect(
      bindingsFromTiers([srv({ enabled: false, tiers: { recommended: ['a'] } })]).servers,
    ).toEqual([]);
  });

  it('skips connections with null or empty recommended tiers', () => {
    expect(bindingsFromTiers([srv({ tiers: null })]).servers).toEqual([]);
    expect(bindingsFromTiers([srv({ tiers: { recommended: [] } })]).servers).toEqual([]);
  });

  it('handles multiple servers independently', () => {
    const out = bindingsFromTiers([
      srv({ id: 's1', tiers: { recommended: ['a'] } }),
      srv({ id: 's2', hasConnection: false }),
      srv({ id: 's3', tiers: { recommended: ['b', 'c'] } }),
    ]);
    expect(out.servers).toEqual([
      { serverId: 's1', enabledTools: ['a'] },
      { serverId: 's3', enabledTools: ['b', 'c'] },
    ]);
  });
});
