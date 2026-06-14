import { describe, it, expect } from 'vitest';
import { bindingsFromToolConfig, mergeMcpIntoToolConfig, isNewTool } from '../merge-tool-config';

describe('bindingsFromToolConfig', () => {
  it('extracts server→tools map from a toolConfig blob', () => {
    const tc = {
      mcp: { servers: [{ serverId: 's1', enabledTools: ['a', 'b'] }] },
      browser: { x: 1 },
    };
    expect(bindingsFromToolConfig(tc)).toEqual({ s1: ['a', 'b'] });
  });
  it('handles missing/malformed mcp gracefully', () => {
    expect(bindingsFromToolConfig(undefined)).toEqual({});
    expect(bindingsFromToolConfig({})).toEqual({});
    expect(bindingsFromToolConfig({ mcp: 'garbage' })).toEqual({});
  });
});

describe('mergeMcpIntoToolConfig', () => {
  it('preserves foreign toolConfig keys (PATCH replaces the whole column)', () => {
    const existing = { browser: { headless: true }, custom: 1 };
    const merged = mergeMcpIntoToolConfig(existing, { s1: ['a'] });
    expect(merged).toEqual({
      browser: { headless: true },
      custom: 1,
      mcp: { servers: [{ serverId: 's1', enabledTools: ['a'] }] },
    });
  });

  it('drops servers with empty selections entirely', () => {
    const merged = mergeMcpIntoToolConfig({}, { s1: [], s2: ['x'] });
    expect(merged['mcp']).toEqual({ servers: [{ serverId: 's2', enabledTools: ['x'] }] });
  });

  it('removes the mcp key when nothing is selected', () => {
    const merged = mergeMcpIntoToolConfig({ browser: {} }, { s1: [] });
    expect(merged).toEqual({ browser: {} });
  });
});

describe('isNewTool', () => {
  it('flags unticked tools only on servers that already have a binding', () => {
    const bindings = { s1: ['a'] };
    expect(isNewTool(bindings, 's1', 'b')).toBe(true); // unticked, server bound
    expect(isNewTool(bindings, 's1', 'a')).toBe(false); // ticked
    expect(isNewTool(bindings, 's2', 'x')).toBe(false); // first-time server: no badges
  });
});
