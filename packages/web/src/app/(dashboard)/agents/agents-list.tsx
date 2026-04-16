'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, ArrowUpDown, Bot, Loader2, MoreHorizontal, Plus } from 'lucide-react';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { authFetch } from '@/lib/auth';
import { useAnimeOnMount, staggerFadeUp, STAGGER } from '@/lib/anime';
import { SuccessDialog } from '@/components/ui/success-dialog';
import { CreateAgentDialog, EditAgentDialog } from './agents-dialogs';

// ------------------------------------------------------------------ //
//  Types (exported for use in dialogs)                                //
// ------------------------------------------------------------------ //

export interface ApiAgent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  role: string;
  provider: string;
  model: string;
  apiBaseUrl: string | null;
  skillIds: string[];
  maxTokensPerRun: number;
  containerConfig: Record<string, unknown>;
  isActive: boolean;
  isOfficial: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PaginatedAgents {
  data: ApiAgent[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

// ------------------------------------------------------------------ //
//  Sorting                                                            //
// ------------------------------------------------------------------ //

type SortKey = 'name' | 'model' | 'role' | 'type' | 'enabled';
type SortDir = 'asc' | 'desc';
interface SortEntry {
  key: SortKey;
  dir: SortDir;
}

const VALID_KEYS: SortKey[] = ['name', 'model', 'role', 'type', 'enabled'];

function parseSorts(param: string | null): SortEntry[] {
  if (!param) return [{ key: 'role', dir: 'asc' }];
  return param
    .split(',')
    .map((s) => {
      const [key, dir] = s.split(':') as [string, string];
      return { key: key as SortKey, dir: (dir === 'desc' ? 'desc' : 'asc') as SortDir };
    })
    .filter((s) => VALID_KEYS.includes(s.key));
}

function serializeSorts(sorts: SortEntry[]): string {
  return sorts.map((s) => `${s.key}:${s.dir}`).join(',');
}

// ------------------------------------------------------------------ //
//  Component                                                          //
// ------------------------------------------------------------------ //

export function AgentsList() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [agents, setAgents] = useState<ApiAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [editAgent, setEditAgent] = useState<ApiAgent | null>(null);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // ---- Sorting ----
  const sorts = parseSorts(searchParams.get('sort'));

  function toggleSort(key: SortKey) {
    const existing = sorts.find((s) => s.key === key);
    let newSorts: SortEntry[];
    if (!existing) {
      newSorts = [...sorts, { key, dir: 'asc' }];
    } else if (existing.dir === 'asc') {
      newSorts = sorts.map((s) => (s.key === key ? { ...s, dir: 'desc' as SortDir } : s));
    } else {
      newSorts = sorts.filter((s) => s.key !== key);
    }
    const params = new URLSearchParams(searchParams.toString());
    if (newSorts.length > 0) {
      params.set('sort', serializeSorts(newSorts));
    } else {
      params.delete('sort');
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  function getSortIcon(key: SortKey) {
    const entry = sorts.find((s) => s.key === key);
    if (!entry) return <ArrowUpDown className="ml-1 inline size-3 text-muted-foreground/40" />;
    if (entry.dir === 'asc') return <ArrowUp className="ml-1 inline size-3" />;
    return <ArrowDown className="ml-1 inline size-3" />;
  }

  useAnimeOnMount(staggerFadeUp('[data-animate="agent-rows"] tr', { stagger: STAGGER.tight }));

  const sortedAgents = useMemo(() => {
    return [...agents].sort((a, b) => {
      for (const { key, dir } of sorts) {
        let cmp = 0;
        switch (key) {
          case 'name':
            cmp = a.name.localeCompare(b.name);
            break;
          case 'model':
            cmp = `${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`);
            break;
          case 'role': {
            const roleOrder: Record<string, number> = { primary: 0, worker: 1 };
            cmp = (roleOrder[a.role] ?? 99) - (roleOrder[b.role] ?? 99);
            break;
          }
          case 'type':
            cmp = Number(b.isOfficial) - Number(a.isOfficial);
            break;
          case 'enabled':
            cmp = Number(b.isActive) - Number(a.isActive);
            break;
        }
        if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  }, [agents, sorts]);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch<PaginatedAgents>('/api/v1/agents?limit=100');
      setAgents(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  async function handleCreate(form: FormData) {
    setSaving(true);
    setError('');
    try {
      await authFetch('/api/v1/agents', {
        method: 'POST',
        body: JSON.stringify({
          name: form.get('name'),
          description: form.get('description') || undefined,
          systemPrompt: form.get('systemPrompt'),
          role: form.get('role') || 'primary',
          provider: form.get('provider'),
          model: form.get('model'),
          apiBaseUrl: form.get('apiBaseUrl') || undefined,
          maxTokensPerRun: Number(form.get('maxTokensPerRun')) || 100000,
          skillIds:
            (form.get('skillIds') as string)
              ?.split(',')
              .map((s) => s.trim())
              .filter(Boolean) || [],
        }),
      });
      setCreateOpen(false);
      await fetchAgents();
      setSuccessMessage(`${form.get('name')} has been created.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: string, form: FormData) {
    setSaving(true);
    setError('');
    try {
      await authFetch(`/api/v1/agents/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.get('name'),
          description: form.get('description') || undefined,
          systemPrompt: form.get('systemPrompt'),
          role: form.get('role') || undefined,
          provider: form.get('provider'),
          model: form.get('model'),
          apiBaseUrl: form.get('apiBaseUrl') || undefined,
          maxTokensPerRun: Number(form.get('maxTokensPerRun')) || 100000,
          skillIds:
            (form.get('skillIds') as string)
              ?.split(',')
              .map((s) => s.trim())
              .filter(Boolean) || [],
        }),
      });
      setEditAgent(null);
      await fetchAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update agent');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(agent: ApiAgent) {
    setSaving(true);
    setError('');
    try {
      await authFetch(`/api/v1/agents/${agent.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !agent.isActive }),
      });
      await fetchAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update agent');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agent Definitions</h1>
          <p className="text-sm text-muted-foreground">
            Manage AI agent definitions and monitor their runs.
          </p>
        </div>
        <Button
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          <Plus className="mr-2 size-4" />
          Create Agent
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : agents.length === 0 ? (
        <div className="rounded-md border bg-background/30 backdrop-blur-sm p-8 text-center text-sm text-muted-foreground">
          No agents configured.
        </div>
      ) : (
        <div className="rounded-md border bg-background/30 backdrop-blur-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => {
                    toggleSort('name');
                  }}
                >
                  Agent {getSortIcon('name')}
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => {
                    toggleSort('model');
                  }}
                >
                  Model {getSortIcon('model')}
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => {
                    toggleSort('role');
                  }}
                >
                  Role {getSortIcon('role')}
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => {
                    toggleSort('type');
                  }}
                >
                  Type {getSortIcon('type')}
                </TableHead>
                <TableHead>Skills</TableHead>
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => {
                    toggleSort('enabled');
                  }}
                >
                  Enabled {getSortIcon('enabled')}
                </TableHead>
                <TableHead className="w-[50px]" />
              </TableRow>
            </TableHeader>
            <TableBody data-animate="agent-rows">
              {sortedAgents.map((agent) => (
                <TableRow key={agent.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Bot className="size-4" />
                      {agent.name}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {agent.provider} / {agent.model}
                  </TableCell>
                  <TableCell>
                    <Badge variant={agent.role === 'primary' ? 'default' : 'secondary'}>
                      {agent.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {agent.isOfficial ? (
                      <Badge variant="outline">Official</Badge>
                    ) : (
                      <Badge variant="secondary">Custom</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{agent.skillIds.length} skills</Badge>
                  </TableCell>
                  <TableCell>
                    {agent.role === 'primary' ? (
                      <span className="text-muted-foreground text-sm">Always on</span>
                    ) : (
                      <Switch
                        checked={agent.isActive}
                        onCheckedChange={() => {
                          void handleToggleActive(agent);
                        }}
                        disabled={saving}
                      />
                    )}
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
                            setEditAgent(agent);
                          }}
                        >
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={`/agents/${agent.id}`}>View Runs</Link>
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

      <CreateAgentDialog
        key={createOpen ? 'open' : 'closed'}
        open={createOpen}
        onOpenChange={setCreateOpen}
        saving={saving}
        onSubmit={handleCreate}
      />

      <EditAgentDialog
        key={editAgent?.id ?? 'none'}
        agent={editAgent}
        onOpenChange={(open) => {
          if (!open) setEditAgent(null);
        }}
        saving={saving}
        onSubmit={handleUpdate}
      />

      <SuccessDialog
        open={successMessage !== ''}
        onOpenChange={(open) => {
          if (!open) setSuccessMessage('');
        }}
        title="Agent Created"
        description={successMessage}
      />
    </div>
  );
}
