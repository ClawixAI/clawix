import { describe, expect, it } from 'vitest';
import { selectBoundAgentIds, type UserAgentBinding } from '../bound-agents';

describe('selectBoundAgentIds', () => {
  const bindings: UserAgentBinding[] = [
    { agentDefinitionId: 'primary-admin', userId: 'admin' },
    { agentDefinitionId: 'primary-dev', userId: 'dev' },
    { agentDefinitionId: 'sub-admin', userId: 'admin' },
  ];

  it("excludes other users' bindings (admin gets ALL bindings from the API)", () => {
    // Regression: the /agents/user-agents endpoint returns every user's
    // bindings to admins. Without filtering, an admin would mark dev's primary
    // as Active too.
    const result = selectBoundAgentIds(bindings, 'admin');
    expect(result).toEqual(new Set(['primary-admin', 'sub-admin']));
    expect(result.has('primary-dev')).toBe(false);
  });

  it('keeps a non-admin user to their own bindings', () => {
    expect(selectBoundAgentIds(bindings, 'dev')).toEqual(new Set(['primary-dev']));
  });

  it('returns an empty set when the current user is unknown', () => {
    expect(selectBoundAgentIds(bindings, undefined)).toEqual(new Set());
  });
});
