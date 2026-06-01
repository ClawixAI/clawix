/** A UserAgent binding as returned by `GET /api/v1/agents/user-agents`. */
export interface UserAgentBinding {
  agentDefinitionId: string;
  userId: string;
}

/**
 * Build the set of `AgentDefinition` ids assigned to a single user.
 *
 * The `/agents/user-agents` endpoint returns ALL users' bindings when the
 * caller is an admin, so callers MUST filter to the current user — otherwise an
 * admin would see every user's primary agent marked "Active" on the agents
 * page instead of only their own assigned primary.
 */
export function selectBoundAgentIds(
  bindings: readonly UserAgentBinding[],
  currentUserId: string | undefined,
): Set<string> {
  if (!currentUserId) return new Set();
  return new Set(
    bindings.filter((b) => b.userId === currentUserId).map((b) => b.agentDefinitionId),
  );
}
