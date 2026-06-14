import { describe, it, expect } from 'vitest';
import { parseTab } from '../[id]/parse-tab';

describe('parseTab', () => {
  it('accepts known tabs', () => {
    expect(parseTab('info')).toBe('info');
    expect(parseTab('tools')).toBe('tools');
    expect(parseTab('calls')).toBe('calls');
  });
  it('accepts the tiers tab', () => {
    expect(parseTab('tiers')).toBe('tiers');
  });
  it('defaults unknown/null to info', () => {
    expect(parseTab('bogus')).toBe('info');
    expect(parseTab(null)).toBe('info');
  });
});
