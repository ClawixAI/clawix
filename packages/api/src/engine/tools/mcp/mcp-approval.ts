import type { McpApprovalOverrides } from '@clawix/shared';

/**
 * Spec §3: overrides win; absent an entry, only an explicit readOnlyHint=true
 * annotation loosens to allow. Annotations are untrusted hints — they can only
 * loosen toward allow for read-only claims, never force-escalate.
 */
export function mcpRequiresApproval(
  toolName: string,
  annotations: unknown,
  overrides: McpApprovalOverrides | null,
): boolean {
  const override = overrides?.[toolName];
  if (override === 'allow') return false;
  if (override === 'ask') return true;
  const readOnly =
    typeof annotations === 'object' &&
    annotations !== null &&
    (annotations as Record<string, unknown>)['readOnlyHint'] === true;
  return !readOnly;
}
