import { authFetch } from '@/lib/auth';

/** A user's standing (`allow_always` / `deny_always`) tool decision — the
 *  Prisma `UserToolApproval` row (Task 1/11). `resourceKey === ''` is the
 *  run-scope sentinel ("any resource"); a non-empty key scopes to one target. */
export interface UserToolApproval {
  id: string;
  toolName: string;
  resourceKey: string;
  decision: 'allowed' | 'denied';
  createdAt: string;
}

interface ListResponse {
  success: boolean;
  data: UserToolApproval[];
}

export async function listStandingApprovals(): Promise<UserToolApproval[]> {
  const res = await authFetch<ListResponse>('/api/v1/tool-approvals');
  return Array.isArray(res.data) ? res.data : [];
}

export async function revokeStandingApproval(id: string): Promise<void> {
  await authFetch(`/api/v1/tool-approvals/${id}`, { method: 'DELETE' });
}
