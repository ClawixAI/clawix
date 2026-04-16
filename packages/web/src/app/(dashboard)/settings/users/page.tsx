'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  EyeIcon,
  EyeOff,
  Loader2,
  Minus,
  MoreHorizontal,
  Plus,
  Shield,
  ShieldCheck,
  Eye,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { useAnimeOnMount, staggerFadeUp, STAGGER } from '@/lib/anime';
import { GroupsTab } from '../groups-tab';

// ------------------------------------------------------------------ //
//  Types                                                              //
// ------------------------------------------------------------------ //

interface ApiUser {
  id: string;
  email: string;
  name: string;
  role: string;
  policyId: string;
  isActive: boolean;
  createdAt: string;
}

interface PaginatedUsers {
  data: ApiUser[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface ApiPolicy {
  id: string;
  name: string;
  isActive: boolean;
}

interface PaginatedPolicies {
  data: ApiPolicy[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

// ------------------------------------------------------------------ //
//  Helpers                                                            //
// ------------------------------------------------------------------ //

function roleVariant(role: string) {
  switch (role) {
    case 'admin':
      return 'default' as const;
    case 'developer':
      return 'secondary' as const;
    default:
      return 'outline' as const;
  }
}

// ------------------------------------------------------------------ //
//  Roles tab data (static — roles are enum-based)                     //
// ------------------------------------------------------------------ //

interface Permission {
  name: string;
  admin: boolean;
  developer: boolean;
  viewer: boolean;
}

interface PermissionGroup {
  category: string;
  permissions: Permission[];
}

function PermissionIcon({ allowed }: { allowed: boolean }) {
  return allowed ? (
    <Check className="mx-auto size-4 text-green-500" aria-label="Allowed" />
  ) : (
    <Minus className="mx-auto size-4 text-muted-foreground/40" aria-label="Not allowed" />
  );
}

const permissionMatrix: PermissionGroup[] = [
  {
    category: 'Agents',
    permissions: [
      { name: 'View agent definitions', admin: true, developer: true, viewer: true },
      { name: 'Create / edit agent', admin: true, developer: true, viewer: false },
      { name: 'Delete agent', admin: true, developer: false, viewer: false },
      { name: 'Run agent', admin: true, developer: true, viewer: false },
    ],
  },
  {
    category: 'Skills',
    permissions: [
      { name: 'Browse marketplace', admin: true, developer: true, viewer: true },
      { name: 'Submit skill', admin: false, developer: true, viewer: false },
      { name: 'Approve / reject skill', admin: true, developer: false, viewer: false },
    ],
  },
  {
    category: 'Governance',
    permissions: [
      { name: 'View token usage (org-wide)', admin: true, developer: false, viewer: true },
      { name: 'View token usage (own)', admin: true, developer: true, viewer: false },
      { name: 'Set budget alerts', admin: true, developer: false, viewer: false },
      { name: 'View audit logs', admin: true, developer: true, viewer: true },
      { name: 'Export audit logs', admin: true, developer: false, viewer: false },
    ],
  },
  {
    category: 'Administration',
    permissions: [
      { name: 'Manage users', admin: true, developer: false, viewer: false },
      { name: 'Assign roles', admin: true, developer: false, viewer: false },
      { name: 'Manage plans', admin: true, developer: false, viewer: false },
      { name: 'Configure providers', admin: true, developer: false, viewer: false },
      { name: 'Org settings', admin: true, developer: false, viewer: false },
      { name: 'Manage groups', admin: true, developer: true, viewer: false },
    ],
  },
];

const roleDescriptions: Record<string, { icon: typeof ShieldCheck; description: string }> = {
  admin: {
    icon: ShieldCheck,
    description:
      'Full platform control: org settings, user management, RBAC, agent lifecycle, channel config, skill approval, providers, system health.',
  },
  developer: {
    icon: Shield,
    description:
      'Build & operate: create agents, write skills, run agents, schedule tasks, monitor usage, manage channels, SDK integration.',
  },
  viewer: {
    icon: Eye,
    description: 'Read-only: dashboards, audit logs, token reports.',
  },
};

// ------------------------------------------------------------------ //
//  Users Page                                                         //
// ------------------------------------------------------------------ //

type SortKey = 'name' | 'email' | 'role' | 'plan' | 'status';
type SortDir = 'asc' | 'desc';
interface SortEntry {
  key: SortKey;
  dir: SortDir;
}

function parseSorts(param: string | null): SortEntry[] {
  if (!param) return [{ key: 'role', dir: 'asc' }]; // default sort
  return param
    .split(',')
    .map((s) => {
      const [key, dir] = s.split(':') as [string, string];
      return { key: key as SortKey, dir: (dir === 'desc' ? 'desc' : 'asc') as SortDir };
    })
    .filter((s) => ['name', 'email', 'role', 'plan', 'status'].includes(s.key));
}

function serializeSorts(sorts: SortEntry[]): string {
  return sorts.map((s) => `${s.key}:${s.dir}`).join(',');
}

export default function UsersPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [policies, setPolicies] = useState<ApiPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState<'form' | 'assign' | 'done'>('form');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [createdUserId, setCreatedUserId] = useState<string | null>(null);
  const [createdUserName, setCreatedUserName] = useState('');
  const [editUser, setEditUser] = useState<ApiUser | null>(null);
  const [deleteUser, setDeleteUser] = useState<ApiUser | null>(null);
  const [saving, setSaving] = useState(false);

  // Agent assignment state
  const [agentDefs, setAgentDefs] = useState<{ id: string; name: string }[]>([]);
  const [assigningAgent, setAssigningAgent] = useState(false);
  // User agent assignments (userId -> { userAgentId, agentDefinitionId })
  const [userAgentMap, setUserAgentMap] = useState<
    Map<string, { userAgentId: string; agentDefinitionId: string }>
  >(new Map());
  const [editUserAgentId, setEditUserAgentId] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [usersRes, policiesRes, agentsRes, userAgentsRes] = await Promise.all([
        authFetch<PaginatedUsers>('/admin/users?limit=100'),
        authFetch<PaginatedPolicies>('/admin/policies?limit=100'),
        authFetch<{ data: { id: string; name: string; role: string }[] }>(
          '/api/v1/agents?role=primary&limit=100',
        ),
        authFetch<{ id: string; userId: string; agentDefinitionId: string }[]>(
          '/api/v1/agents/user-agents',
        ),
      ]);
      setUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
      setPolicies(Array.isArray(policiesRes.data) ? policiesRes.data : []);
      setAgentDefs(agentsRes.data.filter((a) => a.role === 'primary'));
      // Build user -> userAgent mapping
      const map = new Map<string, { userAgentId: string; agentDefinitionId: string }>();
      for (const ua of userAgentsRes) {
        map.set(ua.userId, { userAgentId: ua.id, agentDefinitionId: ua.agentDefinitionId });
      }
      setUserAgentMap(map);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  async function handleCreate(form: FormData) {
    setSaving(true);
    setError('');
    try {
      const created = await authFetch<ApiUser>('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          email: form.get('email'),
          name: form.get('name'),
          password: form.get('password'),
          role: form.get('role'),
          policyId: form.get('policyId'),
        }),
      });
      setCreatedUserId(created.id);
      setCreatedUserName(created.name);
      setSelectedAgentId('');
      setCreateStep('assign');
      // Fetch agent definitions for assignment step
      void authFetch<{ data: { id: string; name: string; role: string; isActive: boolean }[] }>(
        '/api/v1/agents?limit=100&role=primary',
      )
        .then((res) => {
          setAgentDefs(
            Array.isArray(res.data)
              ? res.data.filter((a) => a.isActive).map((a) => ({ id: a.id, name: a.name }))
              : [],
          );
        })
        .catch(() => {
          /* silent */
        });
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setSaving(false);
    }
  }

  async function handleAssignAgent() {
    if (!createdUserId || !selectedAgentId) return;
    setAssigningAgent(true);
    try {
      await authFetch('/api/v1/agents/user-agents', {
        method: 'POST',
        body: JSON.stringify({ userId: createdUserId, agentDefinitionId: selectedAgentId }),
      });
      setCreateStep('done');
    } catch {
      /* silent — agent can be assigned later */
    } finally {
      setAssigningAgent(false);
    }
  }

  function closeCreateDialog() {
    setCreateOpen(false);
    setCreateStep('form');
    setCreatedUserId(null);
    setSelectedAgentId('');
  }

  function openEditUser(user: ApiUser) {
    setEditUser(user);
    const existing = userAgentMap.get(user.id);
    setEditUserAgentId(existing?.agentDefinitionId ?? '');
  }

  async function handleUpdate(id: string, data: Record<string, unknown>, agentDefId: string) {
    setSaving(true);
    setError('');
    try {
      // Update user data
      await authFetch(`/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });

      // Handle primary agent assignment
      const existing = userAgentMap.get(id);
      if (agentDefId && agentDefId !== existing?.agentDefinitionId) {
        if (existing) {
          // Update existing user-agent assignment
          await authFetch(`/api/v1/agents/user-agents/${existing.userAgentId}`, {
            method: 'PATCH',
            body: JSON.stringify({ agentDefinitionId: agentDefId }),
          });
        } else {
          // Create new user-agent assignment
          await authFetch('/api/v1/agents/user-agents', {
            method: 'POST',
            body: JSON.stringify({ userId: id, agentDefinitionId: agentDefId }),
          });
        }
      }

      setEditUser(null);
      setEditUserAgentId('');
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setSaving(true);
    setError('');
    try {
      await authFetch(`/admin/users/${id}`, { method: 'DELETE' });
      setDeleteUser(null);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setSaving(false);
    }
  }

  // ---- Sorting ----
  const sorts = parseSorts(searchParams.get('sort'));

  function toggleSort(key: SortKey) {
    const existing = sorts.find((s) => s.key === key);
    let newSorts: SortEntry[];
    if (!existing) {
      // Add new sort column
      newSorts = [...sorts, { key, dir: 'asc' }];
    } else if (existing.dir === 'asc') {
      // Flip to desc
      newSorts = sorts.map((s) => (s.key === key ? { ...s, dir: 'desc' as SortDir } : s));
    } else {
      // Remove this sort
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

  const sortedUsers = useMemo(() => {
    const roleOrder: Record<string, number> = { admin: 0, developer: 1, viewer: 2 };
    const policyMap = new Map(policies.map((p) => [p.id, p.name]));

    return [...users].sort((a, b) => {
      for (const { key, dir } of sorts) {
        let cmp = 0;
        switch (key) {
          case 'name':
            cmp = a.name.localeCompare(b.name);
            break;
          case 'email':
            cmp = a.email.localeCompare(b.email);
            break;
          case 'role':
            cmp = (roleOrder[a.role] ?? 99) - (roleOrder[b.role] ?? 99);
            break;
          case 'plan':
            cmp = (policyMap.get(a.policyId) ?? '').localeCompare(policyMap.get(b.policyId) ?? '');
            break;
          case 'status':
            cmp = Number(b.isActive) - Number(a.isActive);
            break;
        }
        if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  }, [users, sorts, policies]);

  useAnimeOnMount(staggerFadeUp('[data-animate="user-rows"] tr', { stagger: STAGGER.tight }));

  // Role counts for the Roles tab cards
  const roleCounts = users.reduce<Record<string, number>>((acc, u) => {
    acc[u.role] = (acc[u.role] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
        <p className="text-sm text-muted-foreground">Manage users, roles, and groups.</p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v);
        }}
      >
        <div className="flex items-center justify-between">
          <TabsList className="h-10 rounded-full p-1">
            <TabsTrigger value="users" className="rounded-full px-4">
              Users
            </TabsTrigger>
            <TabsTrigger value="roles" className="rounded-full px-4">
              Roles
            </TabsTrigger>
            <TabsTrigger value="groups" className="rounded-full px-4">
              Groups
            </TabsTrigger>
          </TabsList>
          {tab === 'users' && (
            <Button
              size="sm"
              onClick={() => {
                setCreateOpen(true);
              }}
            >
              <Plus className="mr-1 size-4" />
              Create User
            </Button>
          )}
        </div>

        {/* ---- Users Tab ---- */}
        <TabsContent value="users" className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <div className="rounded-md border bg-background/30 backdrop-blur-sm p-8 text-center text-sm text-muted-foreground">
              No users found.
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
                      Name {getSortIcon('name')}
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => {
                        toggleSort('email');
                      }}
                    >
                      Email {getSortIcon('email')}
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
                        toggleSort('plan');
                      }}
                    >
                      Plan {getSortIcon('plan')}
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => {
                        toggleSort('status');
                      }}
                    >
                      Status {getSortIcon('status')}
                    </TableHead>
                    <TableHead className="w-[50px]" />
                  </TableRow>
                </TableHeader>
                <TableBody data-animate="user-rows">
                  {sortedUsers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell className="text-muted-foreground">{user.email}</TableCell>
                      <TableCell>
                        <Badge variant={roleVariant(user.role)}>{user.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {policies.find((p) => p.id === user.policyId)?.name ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.isActive ? 'secondary' : 'outline'}>
                          {user.isActive ? 'active' : 'inactive'}
                        </Badge>
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
                                openEditUser(user);
                              }}
                            >
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onSelect={() => {
                                setDeleteUser(user);
                              }}
                            >
                              Remove
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
        </TabsContent>

        {/* ---- Roles Tab ---- */}
        <TabsContent value="roles" className="mt-4 space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            {(['admin', 'developer', 'viewer'] as const).map((role) => {
              const def = roleDescriptions[role] ?? { icon: Shield, description: '' };
              const Icon = def.icon;
              const count = roleCounts[role] ?? 0;
              return (
                <div key={role} className="rounded-lg border p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-md bg-muted">
                      <Icon className="size-4" aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="font-semibold capitalize">{role}</h3>
                      <p className="text-xs text-muted-foreground">
                        {count} user{count !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{def.description}</p>
                </div>
              );
            })}
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold">Permission Matrix</h3>
            <div className="rounded-md border bg-background/30 backdrop-blur-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[300px]">Permission</TableHead>
                    <TableHead className="text-center">Admin</TableHead>
                    <TableHead className="text-center">Developer</TableHead>
                    <TableHead className="text-center">Viewer</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {permissionMatrix.map((group) => (
                    <Fragment key={group.category}>
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="bg-muted/50 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          {group.category}
                        </TableCell>
                      </TableRow>
                      {group.permissions.map((perm) => (
                        <TableRow key={perm.name}>
                          <TableCell className="text-sm">{perm.name}</TableCell>
                          <TableCell className="text-center">
                            <PermissionIcon allowed={perm.admin} />
                          </TableCell>
                          <TableCell className="text-center">
                            <PermissionIcon allowed={perm.developer} />
                          </TableCell>
                          <TableCell className="text-center">
                            <PermissionIcon allowed={perm.viewer} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Roles are system-defined. Contact your administrator to change a user&apos;s role.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="groups" className="mt-4">
          <GroupsTab />
        </TabsContent>
      </Tabs>

      {/* ---- Create User Dialog (two-step) ---- */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) closeCreateDialog();
        }}
      >
        <DialogContent>
          {createStep === 'form' && (
            <>
              <DialogHeader>
                <DialogTitle>Create User</DialogTitle>
                <DialogDescription>Add a new user to the platform.</DialogDescription>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleCreate(new FormData(e.currentTarget));
                }}
                className="flex flex-col gap-4"
              >
                <div className="flex flex-col gap-2">
                  <Label htmlFor="create-name">Name</Label>
                  <Input id="create-name" name="name" required />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="create-email">Email</Label>
                  <Input id="create-email" name="email" type="email" required />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="create-password">Password</Label>
                  <div className="relative">
                    <Input
                      id="create-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      minLength={8}
                      required
                      className="pr-10"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setShowPassword((v) => !v);
                      }}
                      tabIndex={-1}
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <EyeIcon className="size-4" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="create-role">Role</Label>
                  <select
                    name="role"
                    id="create-role"
                    className="rounded-md border bg-background px-3 py-2 text-sm"
                    defaultValue="developer"
                  >
                    <option value="admin">Admin</option>
                    <option value="developer">Developer</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="create-plan">Plan</Label>
                  <select
                    name="policyId"
                    id="create-plan"
                    className="rounded-md border bg-background px-3 py-2 text-sm"
                    defaultValue={
                      policies.find((p) => p.name === 'Standard')?.id ?? policies[0]?.id ?? ''
                    }
                  >
                    {policies
                      .filter((p) => p.isActive)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={closeCreateDialog}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                    Create
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}

          {createStep === 'assign' && (
            <div className="flex flex-col items-center gap-6 py-4">
              <div className="flex size-16 items-center justify-center rounded-full bg-green-500/15">
                <Check className="size-8 text-green-500 animate-in zoom-in-50 duration-300" />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-semibold">User Created</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  <strong>{createdUserName}</strong> has been added to the platform.
                </p>
              </div>
              <div className="flex w-full flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="assign-agent-def">Assign Primary Agent</Label>
                  <select
                    id="assign-agent-def"
                    className="rounded-md border bg-background px-3 py-2 text-sm"
                    value={selectedAgentId}
                    onChange={(e) => {
                      setSelectedAgentId(e.target.value);
                    }}
                    disabled={assigningAgent}
                  >
                    <option value="">Select an agent...</option>
                    {agentDefs.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Assign a primary agent so this user can start conversations.
                  </p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={closeCreateDialog}>
                    Skip
                  </Button>
                  <Button
                    disabled={!selectedAgentId || assigningAgent}
                    onClick={() => {
                      void handleAssignAgent();
                    }}
                  >
                    {assigningAgent && <Loader2 className="mr-2 size-4 animate-spin" />}
                    Assign
                  </Button>
                </DialogFooter>
              </div>
            </div>
          )}

          {createStep === 'done' && (
            <div className="flex flex-col items-center gap-6 py-8">
              <div className="flex size-16 items-center justify-center rounded-full bg-green-500/15">
                <Check className="size-8 text-green-500 animate-in zoom-in-50 duration-300" />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-semibold">All Set!</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  <strong>{createdUserName}</strong> has been created and assigned a primary agent.
                </p>
              </div>
              <Button onClick={closeCreateDialog}>Done</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ---- Edit User Dialog ---- */}
      <Dialog
        open={editUser !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditUser(null);
          }
        }}
      >
        {editUser && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit User</DialogTitle>
              <DialogDescription>Update {editUser.name}&apos;s profile.</DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void handleUpdate(
                  editUser.id,
                  {
                    name: form.get('name'),
                    role: form.get('role'),
                    policyId: form.get('policyId'),
                    isActive: form.get('isActive') === 'true',
                  },
                  editUserAgentId,
                );
              }}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="edit-name">Name</Label>
                <Input id="edit-name" name="name" defaultValue={editUser.name} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="edit-role">Role</Label>
                <select
                  name="role"
                  id="edit-role"
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                  defaultValue={editUser.role}
                >
                  <option value="admin">Admin</option>
                  <option value="developer">Developer</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="edit-plan">Plan</Label>
                <select
                  name="policyId"
                  id="edit-plan"
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                  defaultValue={editUser.policyId}
                >
                  {policies
                    .filter((p) => p.isActive)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="edit-status">Status</Label>
                <select
                  name="isActive"
                  id="edit-status"
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                  defaultValue={String(editUser.isActive)}
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="edit-agent">Primary Agent</Label>
                <select
                  id="edit-agent"
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                  value={editUserAgentId}
                  onChange={(e) => {
                    setEditUserAgentId(e.target.value);
                  }}
                >
                  <option value="">No agent assigned</option>
                  {agentDefs.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  The primary agent allows this user to start conversations.
                </p>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditUser(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Save
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>

      {/* ---- Delete User Confirm ---- */}
      <AlertDialog
        open={deleteUser !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteUser(null);
          }
        }}
      >
        {deleteUser && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove User</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove <strong>{deleteUser.name}</strong> (
                {deleteUser.email})? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  void handleDelete(deleteUser.id);
                }}
                disabled={saving}
              >
                {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  );
}
