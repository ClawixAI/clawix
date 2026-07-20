import { describe, expect, it } from 'vitest';

import { mcpRequiresApproval } from '../mcp-approval.js';

describe('mcpRequiresApproval', () => {
  it('explicit allow override wins', () => {
    expect(
      mcpRequiresApproval('send_email', { readOnlyHint: false }, { send_email: 'allow' }),
    ).toBe(false);
  });
  it('explicit ask override wins even over readOnlyHint', () => {
    expect(mcpRequiresApproval('search', { readOnlyHint: true }, { search: 'ask' })).toBe(true);
  });
  it('no override: readOnlyHint true → allow', () => {
    expect(mcpRequiresApproval('search', { readOnlyHint: true }, null)).toBe(false);
  });
  it('no override: missing/false annotations → ask (fail-closed; servers can lie or omit)', () => {
    expect(mcpRequiresApproval('send_email', undefined, null)).toBe(true);
    expect(mcpRequiresApproval('send_email', { readOnlyHint: false }, null)).toBe(true);
    expect(mcpRequiresApproval('send_email', 'garbage', null)).toBe(true);
  });
});
