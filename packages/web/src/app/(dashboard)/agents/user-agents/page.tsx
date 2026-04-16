'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Bot,
  ChevronRight,
  Clock,
  GitBranch,
  Loader2,
  MoreHorizontal,
  Plus,
  Square,
  Wrench,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

// ------------------------------------------------------------------ //
//  Types                                                              //
// ------------------------------------------------------------------ //

interface AgentDefinition {
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
  createdBy?: { id: string; name: string; email: string } | null;
}

interface ProviderInfo {
  name: string;
  displayName: string;
  defaultModel: string;
  models: string[];
}

interface PaginatedAgents {
  data: AgentDefinition[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

// ------------------------------------------------------------------ //
//  Provider hook                                                      //
// ------------------------------------------------------------------ //

function useProviders() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  useEffect(() => {
    void authFetch<{ data: ProviderInfo[] }>('/api/v1/agents/providers')
      .then((res) => {
        setProviders(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => {});
  }, []);

  return providers;
}

// ------------------------------------------------------------------ //
//  Provider + Model select fields                                     //
// ------------------------------------------------------------------ //

function ProviderModelFields({
  providers,
  defaultProvider,
  defaultModel,
  idPrefix,
}: {
  providers: ProviderInfo[];
  defaultProvider?: string;
  defaultModel?: string;
  idPrefix: string;
}) {
  const [selectedProvider, setSelectedProvider] = useState(
    defaultProvider ?? providers[0]?.name ?? '',
  );
  const currentProvider = providers.find((p) => p.name === selectedProvider);
  const models = currentProvider?.models ?? [];

  useEffect(() => {
    if (!selectedProvider && providers.length > 0) {
      setSelectedProvider(defaultProvider ?? providers[0]!.name);
    }
  }, [providers, defaultProvider, selectedProvider]);

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-provider`}>Provider</Label>
        <select
          name="provider"
          id={`${idPrefix}-provider`}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={selectedProvider}
          onChange={(e) => {
            setSelectedProvider(e.target.value);
          }}
        >
          {providers.map((p) => (
            <option key={p.name} value={p.name}>
              {p.displayName}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-model`}>Model</Label>
        {models.length > 0 ? (
          <select
            name="model"
            id={`${idPrefix}-model`}
            className="rounded-md border bg-background px-3 py-2 text-sm"
            defaultValue={defaultModel ?? currentProvider?.defaultModel ?? ''}
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <Input
            id={`${idPrefix}-model`}
            name="model"
            placeholder={currentProvider?.defaultModel ?? 'model-name'}
            defaultValue={defaultModel ?? currentProvider?.defaultModel ?? ''}
            required
          />
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ //
//  Create Agent Dialog                                                //
// ------------------------------------------------------------------ //

function CreateAgentDialog({
  open,
  onOpenChange,
  saving,
  onSubmit,
  title = 'Create Agent',
  description = 'Define a new AI agent with its model, prompt, and skills.',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  onSubmit: (form: FormData) => void;
  title?: string;
  description?: string;
}) {
  const providers = useProviders();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(new FormData(e.currentTarget));
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-name">Name</Label>
            <Input id="create-name" name="name" placeholder="Research Assistant" required />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="create-description">Description</Label>
            <textarea
              id="create-description"
              name="description"
              rows={2}
              className="rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Optional description of this agent"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="create-systemPrompt">System Prompt</Label>
            <textarea
              id="create-systemPrompt"
              name="systemPrompt"
              rows={6}
              className="rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="You are a helpful AI assistant..."
              required
            />
          </div>

          {/* Role is always worker for user-created agents; primary is system-only */}
          <input type="hidden" name="role" value="worker" />

          <ProviderModelFields providers={providers} idPrefix="create" />

          <div className="flex flex-col gap-2">
            <Label htmlFor="create-apiBaseUrl">API Base URL</Label>
            <Input
              id="create-apiBaseUrl"
              name="apiBaseUrl"
              placeholder="https://api.example.com/v1"
            />
            <p className="text-xs text-muted-foreground">
              Optional. Override the default API endpoint for this provider.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="create-maxTokensPerRun">Max Tokens per Run</Label>
            <Input
              id="create-maxTokensPerRun"
              name="maxTokensPerRun"
              type="number"
              defaultValue={100000}
              min={1000}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
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

// ------------------------------------------------------------------ //
//  Edit Agent Dialog                                                  //
// ------------------------------------------------------------------ //

function EditAgentDialog({
  agent,
  onOpenChange,
  saving,
  onSubmit,
}: {
  agent: AgentDefinition | null;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  onSubmit: (id: string, form: FormData) => void;
}) {
  const providers = useProviders();

  if (!agent) return null;

  return (
    <Dialog open={agent !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Agent</DialogTitle>
          <DialogDescription>Update settings for {agent.name}.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(agent.id, new FormData(e.currentTarget));
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input id="edit-name" name="name" defaultValue={agent.name} required />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-description">Description</Label>
            <textarea
              id="edit-description"
              name="description"
              rows={2}
              className="rounded-md border bg-background px-3 py-2 text-sm"
              defaultValue={agent.description}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-systemPrompt">System Prompt</Label>
            <textarea
              id="edit-systemPrompt"
              name="systemPrompt"
              rows={6}
              className="rounded-md border bg-background px-3 py-2 text-sm"
              defaultValue={agent.systemPrompt}
              required
            />
          </div>

          {/* Role cannot be changed; primary is system-only, workers stay workers */}
          <div className="flex flex-col gap-2">
            <Label>Role</Label>
            <p className="text-sm text-muted-foreground">
              {agent.role === 'primary' ? 'Primary (system)' : 'Worker (Sub-Agent)'}
            </p>
            <input type="hidden" name="role" value={agent.role} />
          </div>

          <ProviderModelFields
            providers={providers}
            defaultProvider={agent.provider}
            defaultModel={agent.model}
            idPrefix="edit"
          />

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-apiBaseUrl">API Base URL</Label>
            <Input
              id="edit-apiBaseUrl"
              name="apiBaseUrl"
              defaultValue={agent.apiBaseUrl ?? ''}
              placeholder="https://api.example.com/v1"
            />
            <p className="text-xs text-muted-foreground">
              Optional. Override the default API endpoint for this provider.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-maxTokensPerRun">Max Tokens per Run</Label>
            <Input
              id="edit-maxTokensPerRun"
              name="maxTokensPerRun"
              type="number"
              defaultValue={agent.maxTokensPerRun ?? 100000}
              min={1000}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
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
    </Dialog>
  );
}

// ------------------------------------------------------------------ //
//  Official Agents Table                                              //
// ------------------------------------------------------------------ //

function OfficialAgentsTable({
  agents,
  isAdmin,
  saving,
  onEdit,
  onToggleActive,
}: {
  agents: AgentDefinition[];
  isAdmin: boolean;
  saving: boolean;
  onEdit: (agent: AgentDefinition) => void;
  onToggleActive: (agent: AgentDefinition) => void;
}) {
  if (agents.length === 0) {
    return (
      <div className="rounded-md border bg-background/30 backdrop-blur-sm p-4 text-center text-sm text-muted-foreground">
        No official agents configured.
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-background/30 backdrop-blur-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead className="w-[50px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((agent) => (
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
                <Badge variant="outline">Official</Badge>
              </TableCell>
              <TableCell>
                {agent.role === 'primary' ? (
                  <span className="text-muted-foreground text-sm">Always on</span>
                ) : (
                  <Switch
                    checked={agent.isActive}
                    onCheckedChange={() => {
                      onToggleActive(agent);
                    }}
                    disabled={saving || !isAdmin}
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
                  <DropdownMenuContent
                    align="end"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    {isAdmin && (
                      <DropdownMenuItem
                        onSelect={() => {
                          onEdit(agent);
                        }}
                      >
                        Edit
                      </DropdownMenuItem>
                    )}
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
  );
}

// ------------------------------------------------------------------ //
//  Sub-Agents Table                                                   //
// ------------------------------------------------------------------ //

function SubAgentsTable({
  agents,
  canEdit,
  saving,
  onEdit,
  onToggleActive,
  isAdminViewing = false,
}: {
  agents: AgentDefinition[];
  canEdit: boolean;
  saving: boolean;
  onEdit: (agent: AgentDefinition) => void;
  onToggleActive: (agent: AgentDefinition) => void;
  isAdminViewing?: boolean;
}) {
  if (agents.length === 0) {
    return (
      <div className="rounded-md border bg-background/30 backdrop-blur-sm p-4 text-center text-sm text-muted-foreground">
        No sub-agents created.
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-background/30 backdrop-blur-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead className="w-[50px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((agent) => (
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
                <Badge variant="secondary">{agent.role}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">Custom</Badge>
              </TableCell>
              <TableCell>
                {agent.role === 'primary' ? (
                  <span className="text-muted-foreground text-sm">Always on</span>
                ) : (
                  <Switch
                    checked={agent.isActive}
                    onCheckedChange={() => {
                      onToggleActive(agent);
                    }}
                    disabled={saving || !canEdit}
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
                  <DropdownMenuContent
                    align="end"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    {canEdit && (
                      <DropdownMenuItem
                        onSelect={() => {
                          onEdit(agent);
                        }}
                      >
                        Edit
                      </DropdownMenuItem>
                    )}
                    {isAdminViewing && !canEdit && (
                      <DropdownMenuItem
                        onSelect={() => {
                          onEdit(agent);
                        }}
                      >
                        View Details
                      </DropdownMenuItem>
                    )}
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
  );
}

// ------------------------------------------------------------------ //
//  User Sub-Agents Section (for admin view)                           //
// ------------------------------------------------------------------ //

function UserSubAgentsSection({
  userName,
  userEmail,
  agents,
  defaultOpen = false,
  saving,
  onEdit,
  onToggleActive,
}: {
  userName: string;
  userEmail: string;
  agents: AgentDefinition[];
  defaultOpen?: boolean;
  saving: boolean;
  onEdit: (agent: AgentDefinition) => void;
  onToggleActive: (agent: AgentDefinition) => void;
}) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className="group/user rounded-lg border bg-background/30 backdrop-blur-sm"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 p-4 text-left hover:bg-muted/50">
        <ChevronRight className="size-4 shrink-0 transition-transform duration-200 group-data-[state=open]/user:rotate-90" />
        <div className="flex-1">
          <h3 className="font-semibold">{userName}</h3>
          <p className="text-sm text-muted-foreground">{userEmail}</p>
        </div>
        <Badge variant="outline" className="mr-2">
          {agents.length} sub-agent{agents.length !== 1 ? 's' : ''}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-4 pb-4">
          <SubAgentsTable
            agents={agents}
            canEdit={false}
            saving={saving}
            onEdit={onEdit}
            onToggleActive={onToggleActive}
            isAdminViewing={true}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ------------------------------------------------------------------ //
//  Recent Runs                                                        //
// ------------------------------------------------------------------ //

interface AgentRunEntry {
  id: string;
  status: string;
  input: string;
  output: string | null;
  error: string | null;
  tokenUsage: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
  parentAgentRunId: string | null;
  agentDefinition: { id: string; name: string; role: string };
}

interface ToolCallMessage {
  id: string;
  role: string;
  content: string;
  toolCalls: { id: string; name: string; arguments: string }[] | null;
  toolCallId: string | null;
  createdAt: string;
}

interface AgentRunDetail extends AgentRunEntry {
  toolCallMessages: ToolCallMessage[];
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
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function AgentRunDialog({
  runId,
  onOpenChange,
}: {
  runId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [run, setRun] = useState<AgentRunDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!runId) {
      setRun(null);
      return;
    }
    setLoading(true);
    void authFetch<{ data: AgentRunDetail }>(`/api/v1/chat/agent-runs/${runId}`)
      .then((res) => {
        setRun(res.data);
      })
      .catch(() => {
        setRun(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [runId]);

  return (
    <Dialog open={runId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        {loading ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Bot className="size-5" />
                Loading...
              </DialogTitle>
            </DialogHeader>
            <div className="flex justify-center py-8">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          </>
        ) : run ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Bot className="size-5" />
                {run.agentDefinition.name}
              </DialogTitle>
              <DialogDescription>
                Run started {formatTime(run.startedAt)}
                {run.completedAt &&
                  ` • Duration: ${formatDuration(run.startedAt, run.completedAt)}`}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    run.status === 'completed'
                      ? 'default'
                      : run.status === 'running'
                        ? 'secondary'
                        : 'destructive'
                  }
                >
                  {run.status}
                </Badge>
                {run.parentAgentRunId && (
                  <Badge variant="outline" className="gap-1">
                    <GitBranch className="size-3" />
                    sub-agent
                  </Badge>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <Label className="text-muted-foreground">Input</Label>
                <div className="rounded-md border bg-muted/50 p-3">
                  <pre className="whitespace-pre-wrap text-sm">{run.input}</pre>
                </div>
              </div>

              {run.output && (
                <div className="flex flex-col gap-1">
                  <Label className="text-muted-foreground">Output</Label>
                  <div className="rounded-md border bg-muted/50 p-3 max-h-[300px] overflow-y-auto">
                    <pre className="whitespace-pre-wrap text-sm">{run.output}</pre>
                  </div>
                </div>
              )}

              {run.error && (
                <div className="flex flex-col gap-1">
                  <Label className="text-destructive">Error</Label>
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 max-h-[200px] overflow-y-auto">
                    <pre className="whitespace-pre-wrap text-sm text-destructive">{run.error}</pre>
                  </div>
                </div>
              )}

              {run.toolCallMessages && run.toolCallMessages.length > 0 && (
                <div className="flex flex-col gap-1">
                  <Label className="text-muted-foreground">Tool Calls</Label>
                  <div className="space-y-2">
                    {run.toolCallMessages.map((msg) => (
                      <div key={msg.id} className="rounded-md border bg-muted/50 p-3">
                        {msg.toolCalls ? (
                          msg.toolCalls.map((tc, idx) => (
                            <div key={tc.id || idx} className="mb-2 last:mb-0">
                              <div className="flex items-center gap-2 mb-1">
                                <Wrench className="size-3 text-muted-foreground" />
                                <span className="text-sm font-medium">{tc.name}</span>
                              </div>
                              <pre className="whitespace-pre-wrap text-xs text-muted-foreground bg-background/50 p-2 rounded">
                                {(() => {
                                  try {
                                    // Handle both string and object arguments
                                    const args =
                                      typeof tc.arguments === 'string'
                                        ? JSON.parse(tc.arguments)
                                        : tc.arguments;
                                    return JSON.stringify(args, null, 2);
                                  } catch {
                                    // Fallback: stringify if it's an object, otherwise return as-is
                                    return typeof tc.arguments === 'object'
                                      ? JSON.stringify(tc.arguments, null, 2)
                                      : String(tc.arguments);
                                  }
                                })()}
                              </pre>
                            </div>
                          ))
                        ) : msg.toolCallId ? (
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs text-muted-foreground">Tool Result</span>
                            </div>
                            <pre className="whitespace-pre-wrap text-xs text-muted-foreground bg-background/50 p-2 rounded max-h-[150px] overflow-y-auto">
                              {(() => {
                                const content =
                                  typeof msg.content === 'string'
                                    ? msg.content
                                    : JSON.stringify(msg.content, null, 2);
                                return (
                                  content.slice(0, 2000) + (content.length > 2000 ? '...' : '')
                                );
                              })()}
                            </pre>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {run.tokenUsage && Object.keys(run.tokenUsage).length > 0 && (
                <div className="flex flex-col gap-1">
                  <Label className="text-muted-foreground">Token Usage</Label>
                  <div className="rounded-md border bg-muted/50 p-3">
                    <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {JSON.stringify(run.tokenUsage, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Bot className="size-5" />
                Error
              </DialogTitle>
            </DialogHeader>
            <div className="text-center text-muted-foreground py-4">Failed to load run details</div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecentRuns() {
  const [runs, setRuns] = useState<AgentRunEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  useEffect(() => {
    const fetchRuns = () => {
      void authFetch<{ data: AgentRunEntry[] }>('/api/v1/chat/agent-runs?limit=20')
        .then((res) => {
          setRuns(Array.isArray(res.data) ? res.data : []);
        })
        .catch(() => {})
        .finally(() => {
          setLoading(false);
        });
    };

    fetchRuns();
    const interval = setInterval(fetchRuns, 15_000);
    return () => {
      clearInterval(interval);
    };
  }, []);

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
    <>
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
              <TableRow
                key={run.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => {
                  setSelectedRunId(run.id);
                }}
              >
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
                      run.status === 'completed'
                        ? 'default'
                        : run.status === 'running'
                          ? 'secondary'
                          : 'destructive'
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
      <AgentRunDialog
        runId={selectedRunId}
        onOpenChange={(open) => !open && setSelectedRunId(null)}
      />
    </>
  );
}

// ------------------------------------------------------------------ //
//  View Agent Dialog (read-only for admin viewing others' agents)     //
// ------------------------------------------------------------------ //

function ViewAgentDialog({
  agent,
  onOpenChange,
}: {
  agent: AgentDefinition | null;
  onOpenChange: (open: boolean) => void;
}) {
  if (!agent) return null;

  return (
    <Dialog open={agent !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>View Agent Details</DialogTitle>
          <DialogDescription>Details for {agent.name} (read-only)</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label className="text-muted-foreground">Name</Label>
            <p className="text-sm">{agent.name}</p>
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-muted-foreground">Description</Label>
            <p className="text-sm">{agent.description || '—'}</p>
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-muted-foreground">System Prompt</Label>
            <pre className="rounded-md border bg-muted/50 p-3 text-xs whitespace-pre-wrap max-h-[200px] overflow-y-auto">
              {agent.systemPrompt}
            </pre>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <Label className="text-muted-foreground">Role</Label>
              <p className="text-sm">{agent.role}</p>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-muted-foreground">Status</Label>
              <p className="text-sm">
                {agent.role === 'primary' ? 'Always on' : agent.isActive ? 'Active' : 'Inactive'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <Label className="text-muted-foreground">Provider</Label>
              <p className="text-sm">{agent.provider}</p>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-muted-foreground">Model</Label>
              <p className="text-sm">{agent.model}</p>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-muted-foreground">Max Tokens per Run</Label>
            <p className="text-sm">{agent.maxTokensPerRun?.toLocaleString()}</p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ //
//  Main Page                                                          //
// ------------------------------------------------------------------ //

export default function UserAgentsPage() {
  const { user } = useAuth();
  const [officialAgents, setOfficialAgents] = useState<AgentDefinition[]>([]);
  const [mySubAgents, setMySubAgents] = useState<AgentDefinition[]>([]);
  const [otherUsersSubAgents, setOtherUsersSubAgents] = useState<
    Map<string, { user: { name: string; email: string }; agents: AgentDefinition[] }>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const [createOfficialOpen, setCreateOfficialOpen] = useState(false);
  const [createSubOpen, setCreateSubOpen] = useState(false);
  const [editAgent, setEditAgent] = useState<AgentDefinition | null>(null);
  const [viewAgent, setViewAgent] = useState<AgentDefinition | null>(null);

  const isAdmin = user?.role === 'admin';
  const currentUserId = user?.sub;

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch<PaginatedAgents>(
        '/api/v1/agents?limit=100&includeCreatedBy=true',
      );
      const all = Array.isArray(res.data) ? res.data : [];

      // Official agents (primary first, then workers)
      setOfficialAgents(
        all
          .filter((a) => a.isOfficial)
          .sort((a, b) => (a.role === 'primary' ? -1 : 1) - (b.role === 'primary' ? -1 : 1)),
      );

      // My sub-agents (created by current user)
      setMySubAgents(all.filter((a) => !a.isOfficial && a.createdById === currentUserId));

      // Other users' sub-agents (admin only)
      if (isAdmin) {
        const otherAgents = all.filter(
          (a) => !a.isOfficial && a.createdById && a.createdById !== currentUserId,
        );
        const grouped = new Map<
          string,
          { user: { name: string; email: string }; agents: AgentDefinition[] }
        >();

        for (const agent of otherAgents) {
          if (!agent.createdById || !agent.createdBy) continue;
          const existing = grouped.get(agent.createdById);
          if (existing) {
            existing.agents.push(agent);
          } else {
            grouped.set(agent.createdById, {
              user: { name: agent.createdBy.name, email: agent.createdBy.email },
              agents: [agent],
            });
          }
        }
        setOtherUsersSubAgents(grouped);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, currentUserId]);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  async function handleCreateOfficial(form: FormData) {
    setSaving(true);
    setError('');
    try {
      const name = form.get('name') as string;
      await authFetch('/api/v1/agents', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: form.get('description') || undefined,
          systemPrompt: form.get('systemPrompt'),
          role: form.get('role') || 'primary',
          provider: form.get('provider'),
          model: form.get('model'),
          apiBaseUrl: form.get('apiBaseUrl') || undefined,
          maxTokensPerRun: Number(form.get('maxTokensPerRun')) || 100000,
          isOfficial: true,
        }),
      });
      setCreateOfficialOpen(false);
      await fetchAgents();
      setSuccessMessage(`${name} has been created.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateSub(form: FormData) {
    setSaving(true);
    setError('');
    try {
      const name = form.get('name') as string;
      await authFetch('/api/v1/agents', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: form.get('description') || undefined,
          systemPrompt: form.get('systemPrompt'),
          role: form.get('role') || 'worker',
          provider: form.get('provider'),
          model: form.get('model'),
          apiBaseUrl: form.get('apiBaseUrl') || undefined,
          maxTokensPerRun: Number(form.get('maxTokensPerRun')) || 100000,
          isOfficial: false,
        }),
      });
      setCreateSubOpen(false);
      await fetchAgents();
      setSuccessMessage(`${name} has been created.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create sub-agent');
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

  async function handleToggleActive(agent: AgentDefinition) {
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

  // Handle edit vs view based on ownership
  function handleAgentAction(agent: AgentDefinition, isOwner: boolean) {
    if (isOwner || (isAdmin && agent.isOfficial)) {
      setEditAgent(agent);
    } else {
      setViewAgent(agent);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "Manage official agents and monitor all users' sub-agents."
              : 'View official agents and manage your sub-agents.'}
          </p>
        </div>
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
      ) : (
        <div className="space-y-8">
          {/* Official Agents Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Official Agents</h2>
              {isAdmin && (
                <Button
                  size="sm"
                  onClick={() => {
                    setCreateOfficialOpen(true);
                  }}
                >
                  <Plus className="mr-1 size-4" />
                  Create Agent
                </Button>
              )}
            </div>
            <OfficialAgentsTable
              agents={officialAgents}
              isAdmin={isAdmin}
              saving={saving}
              onEdit={setEditAgent}
              onToggleActive={handleToggleActive}
            />
          </div>

          {/* My Sub-Agents Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">My Sub-Agents</h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setCreateSubOpen(true);
                }}
              >
                <Plus className="mr-1 size-4" />
                Create Sub-Agent
              </Button>
            </div>
            <SubAgentsTable
              agents={mySubAgents}
              canEdit={true}
              saving={saving}
              onEdit={setEditAgent}
              onToggleActive={handleToggleActive}
            />
          </div>

          {/* Other Users' Sub-Agents (Admin only) */}
          {isAdmin && otherUsersSubAgents.size > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Other Users&apos; Sub-Agents</h2>
              <div className="space-y-3">
                {Array.from(otherUsersSubAgents.entries()).map(
                  ([userId, { user: userData, agents }]) => (
                    <UserSubAgentsSection
                      key={userId}
                      userName={userData.name}
                      userEmail={userData.email}
                      agents={agents}
                      saving={saving}
                      onEdit={(agent) => {
                        handleAgentAction(agent, false);
                      }}
                      onToggleActive={handleToggleActive}
                    />
                  ),
                )}
              </div>
            </div>
          )}

          {/* Recent Agent Runs */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="size-5 text-muted-foreground" />
                <h2 className="text-lg font-semibold">Recent Agent Runs</h2>
              </div>
              <Button
                size="sm"
                variant="destructive"
                className="gap-1"
                onClick={() => {
                  void authFetch('/api/v1/chat/agent-runs/stop', { method: 'POST' })
                    .then(() => fetchAgents())
                    .catch(() => {});
                }}
              >
                <Square className="size-3" />
                Stop All
              </Button>
            </div>
            <RecentRuns />
          </div>
        </div>
      )}

      {/* Create Official Agent Dialog */}
      <CreateAgentDialog
        key={createOfficialOpen ? 'official-open' : 'official-closed'}
        open={createOfficialOpen}
        onOpenChange={setCreateOfficialOpen}
        saving={saving}
        onSubmit={handleCreateOfficial}
        title="Create Official Agent"
        description="Create a new official agent available to all users."
      />

      {/* Create Sub-Agent Dialog */}
      <CreateAgentDialog
        key={createSubOpen ? 'sub-open' : 'sub-closed'}
        open={createSubOpen}
        onOpenChange={setCreateSubOpen}
        saving={saving}
        onSubmit={handleCreateSub}
        title="Create Sub-Agent"
        description="Create a custom sub-agent for specialized tasks."
      />

      {/* Edit Agent Dialog */}
      <EditAgentDialog
        key={editAgent?.id ?? 'none'}
        agent={editAgent}
        onOpenChange={(open) => {
          if (!open) setEditAgent(null);
        }}
        saving={saving}
        onSubmit={handleUpdate}
      />

      {/* View Agent Dialog (read-only) */}
      <ViewAgentDialog
        agent={viewAgent}
        onOpenChange={(open) => {
          if (!open) setViewAgent(null);
        }}
      />

      <SuccessDialog
        open={successMessage !== ''}
        onOpenChange={(open) => {
          if (!open) setSuccessMessage('');
        }}
        title="Success"
        description={successMessage}
      />
    </div>
  );
}
