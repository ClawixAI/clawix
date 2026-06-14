'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, MoreHorizontal, Plus, Shield } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { authFetch } from '@/lib/auth';
import { SuccessDialog } from '@/components/ui/success-dialog';
import { DataPagination, type PaginationMeta } from '@/components/ui/data-pagination';
import { usePaginationParams } from '@/hooks/use-pagination-params';
import { CreatePolicyDialog, EditPolicyDialog } from './policies-dialogs';

// ------------------------------------------------------------------ //
//  Types (exported for use in dialogs)                                //
// ------------------------------------------------------------------ //

export interface ApiPolicy {
  id: string;
  name: string;
  description: string | null;
  maxTokenBudget: number | null;
  maxAgents: number;
  maxSkills: number;
  maxGroupsOwned: number;
  allowedProviders: string[];
  cronEnabled: boolean;
  maxScheduledTasks: number;
  minCronIntervalSecs: number;
  maxTokensPerCronRun: number | null;
  features: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  allowMcp: boolean;
}

interface PaginatedPolicies {
  data: ApiPolicy[];
  meta: PaginationMeta;
}

interface ApiProvider {
  provider: string;
  displayName: string;
}

// ------------------------------------------------------------------ //
//  Helpers                                                            //
// ------------------------------------------------------------------ //

function formatBudget(cents: number | null): string {
  if (cents === null) return 'Unlimited';
  return `$${(cents / 100).toFixed(2)}/mo`;
}

// ------------------------------------------------------------------ //
//  Component                                                          //
// ------------------------------------------------------------------ //

export function PoliciesTab() {
  const { page, limit, setPage, setLimit } = usePaginationParams();
  const [policies, setPolicies] = useState<ApiPolicy[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({
    total: 0,
    page: 1,
    limit,
    totalPages: 0,
  });
  const [providerNames, setProviderNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [editPolicy, setEditPolicy] = useState<ApiPolicy | null>(null);
  const [deletePolicy, setDeletePolicy] = useState<ApiPolicy | null>(null);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [policiesRes, providersRes] = await Promise.all([
        authFetch<PaginatedPolicies>(`/admin/policies?page=${page}&limit=${limit}`),
        authFetch<ApiProvider[]>('/admin/providers'),
      ]);
      setPolicies(Array.isArray(policiesRes.data) ? policiesRes.data : []);
      setMeta(policiesRes.meta);
      const nameMap: Record<string, string> = {};
      for (const p of providersRes ?? []) {
        nameMap[p.provider] = p.displayName;
      }
      setProviderNames(nameMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load policies');
    } finally {
      setLoading(false);
    }
  }, [page, limit]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  async function handleCreate(data: Record<string, unknown>) {
    setSaving(true);
    setError('');
    try {
      await authFetch('/admin/policies', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      setCreateOpen(false);
      await fetchData();
      setSuccessMessage(`${(data as { name?: string }).name ?? 'Policy'} has been created.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create policy');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(policy: ApiPolicy) {
    setSaving(true);
    setError('');
    try {
      await authFetch(`/admin/policies/${policy.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !policy.isActive }),
      });
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update policy');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: string, data: Record<string, unknown>) {
    setSaving(true);
    setError('');
    try {
      await authFetch(`/admin/policies/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
      setEditPolicy(null);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update policy');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setSaving(true);
    setError('');
    try {
      await authFetch(`/admin/policies/${id}`, { method: 'DELETE' });
      setDeletePolicy(null);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete policy');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-end">
        <Button
          size="sm"
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          <Plus className="mr-1 size-4" />
          Create Policy
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : policies.length === 0 ? (
        <div className="rounded-md border bg-background/30 backdrop-blur-sm p-8 text-center text-sm text-muted-foreground">
          No policies configured. Click &quot;Create Policy&quot; to get started.
        </div>
      ) : (
        <div className="rounded-md border bg-background/30 backdrop-blur-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Policy</TableHead>
                <TableHead>Token Budget</TableHead>
                <TableHead>Agents</TableHead>
                <TableHead>Providers</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-[50px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {policies.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Shield className="size-4" />
                      {p.name}
                    </div>
                    {p.description && (
                      <span className="text-xs text-muted-foreground">{p.description}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-2 py-1 text-xs">
                      {formatBudget(p.maxTokenBudget)}
                    </code>
                  </TableCell>
                  <TableCell className="text-sm">{p.maxAgents}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(() => {
                        const configured = p.allowedProviders.filter(
                          (prov) => prov in providerNames,
                        );
                        return configured.length > 0 ? (
                          configured.map((prov) => (
                            <Badge key={prov} variant="outline" className="text-xs">
                              {providerNames[prov]}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">None</span>
                        );
                      })()}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={p.isActive}
                      onCheckedChange={() => {
                        void handleToggleActive(p);
                      }}
                      disabled={saving}
                    />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            setEditPolicy(p);
                          }}
                        >
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onSelect={() => {
                            setDeletePolicy(p);
                          }}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!loading && policies.length > 0 ? (
        <div className="mt-4">
          <DataPagination
            meta={meta}
            onPageChange={setPage}
            onLimitChange={setLimit}
            label="policies"
          />
        </div>
      ) : null}

      <CreatePolicyDialog
        key={createOpen ? 'create-open' : 'create-closed'}
        open={createOpen}
        onOpenChange={setCreateOpen}
        saving={saving}
        onSubmit={handleCreate}
      />

      <EditPolicyDialog
        key={editPolicy?.id ?? 'none'}
        policy={editPolicy}
        onOpenChange={(open) => {
          if (!open) setEditPolicy(null);
        }}
        saving={saving}
        onSubmit={handleUpdate}
      />

      <AlertDialog
        open={deletePolicy !== null}
        onOpenChange={(open) => {
          if (!open) setDeletePolicy(null);
        }}
      >
        {deletePolicy && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Policy</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete <strong>{deletePolicy.name}</strong>? Users assigned
                to this policy must be reassigned first.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  void handleDelete(deletePolicy.id);
                }}
                disabled={saving}
              >
                {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>

      <SuccessDialog
        open={successMessage !== ''}
        onOpenChange={(open) => {
          if (!open) setSuccessMessage('');
        }}
        title="Policy Created"
        description={successMessage}
      />
    </>
  );
}
