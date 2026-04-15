'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, ChevronRight, Clock, GitBranch, Loader2, MoreHorizontal, Plus, Square } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { authFetch } from '@/lib/auth';
import { SuccessDialog } from '@/components/ui/success-dialog';
import { useAuth } from '@/components/auth-provider';

interface UserAgentDetail {
  id: string;
  userId: string;
  agentDefinitionId: string;
  workspacePath: string;
  lastSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  user: { id: string; name: string; email: string };
  agentDefinition: {
    id: string;
    name: string;
    role: string;
    provider: string;
    model: string;
    isActive: boolean;
    isOfficial: boolean;
    createdById: string | null;
  };
}

function AgentTable({
  title,
  agents,
  isAdmin,
  onEdit,
  onDelete,
}: {
  title: string;
  agents: UserAgentDetail[];
  isAdmin?: boolean;
  onEdit?: (ua: UserAgentDetail) => void;
  onDelete?: (ua: UserAgentDetail) => void;
}) {
  if (agents.length === 0) {
    return (
      <div>
        {title && <h3 className="mb-2 text-sm font-semibold">{title}</h3>}
        <div className="rounded-md border bg-background/30 backdrop-blur-sm p-4 text-center text-sm text-muted-foreground">
          No agents assigned.
        </div>
      </div>
    );
  }

  return (
    <div>
      {title && <h3 className="mb-2 text-sm font-semibold">{title}</h3>}
      <div className="rounded-md border bg-background/30 backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Official</TableHead>
              <TableHead>Status</TableHead>
              {isAdmin && <TableHead className="w-[50px]" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.map((ua) => (
              <TableRow key={ua.id}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <Bot className="size-4" />
                    {ua.agentDefinition.name}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {ua.agentDefinition.provider} / {ua.agentDefinition.model}
                </TableCell>
                <TableCell>
                  <Badge variant={ua.agentDefinition.role === 'primary' ? 'default' : 'secondary'}>
                    {ua.agentDefinition.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  {ua.agentDefinition.isOfficial ? (
                    <Badge variant="outline">Official</Badge>
                  ) : (
                    <Badge variant="secondary">Custom</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={ua.agentDefinition.isActive ? 'default' : 'outline'}>
                    {ua.agentDefinition.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                {isAdmin && (
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => { onEdit?.(ua); }}>
                          Change Agent
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onSelect={() => { onDelete?.(ua); }}
                        >
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CreateSubAgentDialog({
  open,
  onOpenChange,
  onCreated,
  onSuccess,
  userId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  onSuccess?: (message: string) => void;
  userId: string;
}) {
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Sub-Agent</DialogTitle>
          <DialogDescription>
            Define a new worker agent for sub-agent tasks.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setSaving(true);
            setDialogError('');
            const name = form.get('name') as string;
            void authFetch('/api/v1/agents/sub-agents', {
              method: 'POST',
              body: JSON.stringify({
                userId,
                name,
                description: form.get('description') || undefined,
                systemPrompt: form.get('systemPrompt'),
                provider: form.get('provider'),
                model: form.get('model'),
                maxTokensPerRun: Number(form.get('maxTokensPerRun')) || 100000,
              }),
            })
              .then(() => {
                onOpenChange(false);
                onCreated();
                onSuccess?.(`${name} has been created.`);
              })
              .catch((err: unknown) => {
                setDialogError(err instanceof Error ? err.message : 'Failed to create sub-agent');
              })
              .finally(() => { setSaving(false); });
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="sub-name">Name</Label>
            <Input id="sub-name" name="name" placeholder="Research Assistant" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="sub-description">Description</Label>
            <textarea
              id="sub-description"
              name="description"
              rows={2}
              className="rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Optional description"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="sub-systemPrompt">System Prompt</Label>
            <textarea
              id="sub-systemPrompt"
              name="systemPrompt"
              rows={4}
              className="rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="You are a helpful assistant..."
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="sub-provider">Provider</Label>
            <select name="provider" id="sub-provider" className="rounded-md border bg-background px-3 py-2 text-sm">
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="deepseek">DeepSeek</option>
              <option value="ollama">Ollama</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="sub-model">Model</Label>
            <Input id="sub-model" name="model" placeholder="claude-haiku-4-5-20251001" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="sub-maxTokens">Max Tokens per Run</Label>
            <Input id="sub-maxTokens" name="maxTokensPerRun" type="number" defaultValue={100000} min={1000} />
          </div>

          {dialogError && (
            <div className="text-sm text-destructive">{dialogError}</div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { onOpenChange(false); }}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChangeAgentDialog({
  open,
  onOpenChange,
  userAgent,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userAgent: UserAgentDetail | null;
  onChanged: () => void;
}) {
  const [agentDefs, setAgentDefs] = useState<ApiAgent[]>([]);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState('');

  useEffect(() => {
    if (!open) return;
    void authFetch<PaginatedAgents>('/api/v1/agents?limit=100&role=primary')
      .then((res) => {
        setAgentDefs(Array.isArray(res.data) ? res.data.filter((a) => a.isActive !== false) : []);
      })
      .catch(() => { setDialogError('Failed to load agent definitions'); });
  }, [open]);

  if (!userAgent) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change Agent Assignment</DialogTitle>
          <DialogDescription>
            Change the primary agent for this user. Currently: {userAgent.agentDefinition.name}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setSaving(true);
            setDialogError('');
            void authFetch(`/api/v1/agents/user-agents/${userAgent.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ agentDefinitionId: form.get('agentDefinitionId') }),
            })
              .then(() => { onOpenChange(false); onChanged(); })
              .catch((err: unknown) => {
                setDialogError(err instanceof Error ? err.message : 'Failed to update');
              })
              .finally(() => { setSaving(false); });
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="change-agent">Agent Definition</Label>
            <select
              name="agentDefinitionId"
              id="change-agent"
              className="rounded-md border bg-background px-3 py-2 text-sm"
              defaultValue={userAgent.agentDefinitionId}
              required
            >
              {agentDefs.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          {dialogError && <div className="text-sm text-destructive">{dialogError}</div>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { onOpenChange(false); }}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface AgentRunEntry {
  id: string;
  status: string;
  input: string;
  output: string | null;
  tokenUsage: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
  parentAgentRunId: string | null;
  agentDefinition: { id: string; name: string; role: string };
}

function formatDuration(start: string, end: string | null): string {
  const endTime = end ? new Date(end).getTime() : Date.now();
  const ms = endTime - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function RecentRuns({ userId }: { userId: string }) {
  const [runs, setRuns] = useState<AgentRunEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRuns = () => {
      void authFetch<{ data: AgentRunEntry[] }>('/api/v1/chat/agent-runs?limit=20')
        .then((res) => setRuns(Array.isArray(res.data) ? res.data : []))
        .catch(() => {})
        .finally(() => setLoading(false));
    };

    fetchRuns();
    const interval = setInterval(fetchRuns, 15_000);
    return () => clearInterval(interval);
  }, [userId]);

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-md border bg-background/30 backdrop-blur-sm p-4 text-center text-sm text-muted-foreground">
        No agent runs yet.
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-background/30 backdrop-blur-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Input</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  <Bot className="size-4 shrink-0" />
                  {run.agentDefinition.name}
                </div>
              </TableCell>
              <TableCell>
                {run.parentAgentRunId ? (
                  <Badge variant="outline" className="gap-1">
                    <GitBranch className="size-3" />
                    sub-agent
                  </Badge>
                ) : (
                  <Badge variant="secondary">{run.agentDefinition.role}</Badge>
                )}
              </TableCell>
              <TableCell className="max-w-[200px]">
                <p className="truncate text-xs text-muted-foreground">
                  {run.input.slice(0, 100)}
                </p>
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    run.status === 'completed' ? 'default' :
                    run.status === 'running' ? 'secondary' :
                    'destructive'
                  }
                >
                  {run.status}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDuration(run.startedAt, run.completedAt)}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatTime(run.startedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function UserSection({
  userId,
  userName,
  userEmail,
  agents,
  defaultOpen = false,
  isAdmin = false,
  onRefresh,
  onSuccess,
}: {
  userId: string;
  userName: string;
  userEmail: string;
  agents: UserAgentDetail[];
  defaultOpen?: boolean;
  isAdmin?: boolean;
  onRefresh: () => void;
  onSuccess?: (message: string) => void;
}) {
  const [createSubOpen, setCreateSubOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UserAgentDetail | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserAgentDetail | null>(null);
  const [deleting, setDeleting] = useState(false);
  const primaryAgents = agents.filter((a) => a.agentDefinition.role === 'primary');
  const subAgents = agents.filter((a) => a.agentDefinition.role !== 'primary');

  function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    void authFetch(`/api/v1/agents/user-agents/${deleteTarget.id}`, { method: 'DELETE' })
      .then(() => { setDeleteTarget(null); onRefresh(); })
      .catch(() => { /* silent */ })
      .finally(() => { setDeleting(false); });
  }

  return (
    <Collapsible defaultOpen={defaultOpen} className="group/user rounded-lg border bg-background/30 backdrop-blur-sm">
      <CollapsibleTrigger className="flex w-full items-center gap-2 p-4 text-left hover:bg-muted/50">
        <ChevronRight className="size-4 shrink-0 transition-transform duration-200 group-data-[state=open]/user:rotate-90" />
        <div className="flex-1">
          <h2 className="text-lg font-semibold">{userName}</h2>
          <p className="text-sm text-muted-foreground">{userEmail}</p>
        </div>
        <Badge variant="outline" className="mr-2">
          {agents.length} agent{agents.length !== 1 ? 's' : ''}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-4 px-4 pb-4">
          <AgentTable
            title="Primary Agents"
            agents={primaryAgents}
            isAdmin={isAdmin}
            onEdit={setEditTarget}
            onDelete={setDeleteTarget}
          />
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Sub-Agents</h3>
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => { e.stopPropagation(); setCreateSubOpen(true); }}
            >
              <Plus className="mr-1 size-3" />
              Create Sub-Agent
            </Button>
          </div>
          {subAgents.length === 0 ? (
            <div className="rounded-md border bg-background/30 backdrop-blur-sm p-4 text-center text-sm text-muted-foreground">
              No agents assigned.
            </div>
          ) : (
            <AgentTable
              title=""
              agents={subAgents}
              isAdmin={isAdmin}
              onEdit={setEditTarget}
              onDelete={setDeleteTarget}
            />
          )}

          {/* Recent Agent Runs */}
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Recent Agent Runs</h3>
            </div>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 gap-1 text-xs"
              onClick={() => {
                void authFetch('/api/v1/chat/agent-runs/stop', { method: 'POST' })
                  .then(() => onRefresh())
                  .catch(() => {});
              }}
            >
              <Square className="size-3" />
              Stop All
            </Button>
          </div>
          <RecentRuns userId={userId} />
        </div>
      </CollapsibleContent>
      <CreateSubAgentDialog
        open={createSubOpen}
        onOpenChange={setCreateSubOpen}
        onCreated={onRefresh}
        onSuccess={onSuccess}
        userId={userId}
      />
      <ChangeAgentDialog
        open={editTarget !== null}
        onOpenChange={(open) => { if (!open) setEditTarget(null); }}
        userAgent={editTarget}
        onChanged={onRefresh}
      />
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      >
        {deleteTarget && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove Agent Assignment</AlertDialogTitle>
              <AlertDialogDescription>
                Remove <strong>{deleteTarget.agentDefinition.name}</strong> from this user?
                This will unlink the agent but not delete the agent definition.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting && <Loader2 className="mr-2 size-4 animate-spin" />}
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </Collapsible>
  );
}

interface ApiUser {
  id: string;
  name: string;
  email: string;
}

interface ApiAgent {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
}

interface PaginatedUsers {
  data: ApiUser[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface PaginatedAgents {
  data: ApiAgent[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

function AssignAgentDialog({
  open,
  onOpenChange,
  onCreated,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  onSuccess?: (message: string) => void;
}) {
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [agents, setAgents] = useState<ApiAgent[]>([]);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState('');

  useEffect(() => {
    if (!open) return;
    void Promise.all([
      authFetch<PaginatedUsers>('/admin/users?limit=100'),
      authFetch<PaginatedAgents>('/api/v1/agents?limit=100&role=primary'),
    ]).then(([usersRes, agentsRes]) => {
      setUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
      setAgents(Array.isArray(agentsRes.data) ? agentsRes.data.filter((a) => a.isActive !== false) : []);
    }).catch(() => {
      setDialogError('Failed to load users or agents');
    });
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign Primary Agent</DialogTitle>
          <DialogDescription>
            Assign a primary agent definition to a user.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setSaving(true);
            setDialogError('');
            const selectedAgentId = form.get('agentDefinitionId') as string;
            const agentName = agents.find((a) => a.id === selectedAgentId)?.name ?? 'Agent';
            void authFetch('/api/v1/agents/user-agents', {
              method: 'POST',
              body: JSON.stringify({
                userId: form.get('userId'),
                agentDefinitionId: selectedAgentId,
              }),
            })
              .then(() => {
                onOpenChange(false);
                onCreated();
                onSuccess?.(`${agentName} has been assigned.`);
              })
              .catch((err: unknown) => {
                setDialogError(err instanceof Error ? err.message : 'Failed to assign agent');
              })
              .finally(() => { setSaving(false); });
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="assign-user">User</Label>
            <select
              name="userId"
              id="assign-user"
              className="rounded-md border bg-background px-3 py-2 text-sm"
              required
            >
              <option value="">Select a user...</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="assign-agent">Primary Agent Definition</Label>
            <select
              name="agentDefinitionId"
              id="assign-agent"
              className="rounded-md border bg-background px-3 py-2 text-sm"
              required
            >
              <option value="">Select an agent...</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {dialogError && (
            <div className="text-sm text-destructive">{dialogError}</div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { onOpenChange(false); }}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Assign
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function UserAgentsPage() {
  const { user } = useAuth();
  const [userAgents, setUserAgents] = useState<UserAgentDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const isAdmin = user?.role === 'admin';

  const fetchUserAgents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch<UserAgentDetail[]>('/api/v1/agents/user-agents');
      setUserAgents(Array.isArray(res) ? res : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUserAgents();
  }, [fetchUserAgents]);

  const groupedByUser = userAgents.reduce<Record<string, UserAgentDetail[]>>((acc, ua) => {
    const key = ua.userId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(ua);
    return acc;
  }, {});

  const currentUserId = user?.sub;
  const myAgents = currentUserId ? (groupedByUser[currentUserId] ?? []) : [];
  const otherUserIds = Object.keys(groupedByUser).filter((id) => id !== currentUserId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">User Agents</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? 'View all users\' agent assignments — primary and sub-agents.'
              : 'View your agent assignments — primary and sub-agents.'}
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => { setAssignOpen(true); }}>
            <Plus className="mr-2 size-4" />
            Assign Agent
          </Button>
        )}
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
      ) : userAgents.length === 0 ? (
        <div className="rounded-md border bg-background/30 backdrop-blur-sm p-8 text-center text-sm text-muted-foreground">
          No agent assignments found.
        </div>
      ) : (
        <div className="space-y-6">
          {myAgents.length > 0 && currentUserId && (
            <UserSection
              userId={currentUserId}
              userName="Your Agents"
              userEmail={user?.email ?? ''}
              agents={myAgents}
              isAdmin={isAdmin}
              defaultOpen
              onRefresh={() => { void fetchUserAgents(); }}
              onSuccess={setSuccessMessage}
            />
          )}

          {isAdmin &&
            otherUserIds.map((userId) => {
              const agents = groupedByUser[userId]!;
              const first = agents[0]!;
              return (
                <UserSection
                  key={userId}
                  userId={userId}
                  userName={first.user.name}
                  userEmail={first.user.email}
                  isAdmin={isAdmin}
                  agents={agents}
                  onRefresh={() => { void fetchUserAgents(); }}
                  onSuccess={setSuccessMessage}
                />
              );
            })}
        </div>
      )}

      {isAdmin && (
        <AssignAgentDialog
          open={assignOpen}
          onOpenChange={setAssignOpen}
          onCreated={() => { void fetchUserAgents(); }}
          onSuccess={setSuccessMessage}
        />
      )}

      <SuccessDialog
        open={successMessage !== ''}
        onOpenChange={(open) => { if (!open) setSuccessMessage(''); }}
        title="Agent Assigned"
        description={successMessage}
      />
    </div>
  );
}
