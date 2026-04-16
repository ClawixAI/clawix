'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Bot, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { authFetch } from '@/lib/auth';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AgentDetail {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  role: string;
  provider: string;
  model: string;
  skillIds: string[];
  maxTokensPerRun: number;
  isActive: boolean;
  createdAt: string;
}

interface AgentRun {
  id: string;
  status: string;
  input: string;
  output: string | null;
  error: string | null;
  tokenUsage: { inputTokens?: number; outputTokens?: number } | null;
  startedAt: string;
  completedAt: string | null;
}

interface PaginatedRuns {
  data: AgentRun[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function statusVariant(status: string) {
  switch (status) {
    case 'completed':
      return 'secondary' as const;
    case 'failed':
      return 'destructive' as const;
    case 'running':
      return 'default' as const;
    default:
      return 'outline' as const;
  }
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return '—';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function AgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params['id'] as string;

  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [runsMeta, setRunsMeta] = useState<PaginatedRuns['meta'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [agentRes, runsRes] = await Promise.all([
        authFetch<AgentDetail>(`/api/v1/agents/${id}`),
        authFetch<PaginatedRuns>(`/api/v1/agents/${id}/runs?limit=50`),
      ]);
      setAgent(agentRes);
      setRuns(runsRes.data);
      setRunsMeta(runsRes.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agent');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  /* Loading state */
  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="text-muted-foreground size-8 animate-spin" />
      </div>
    );
  }

  /* Error state */
  if (error) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            router.push('/agents');
          }}
        >
          <ArrowLeft className="mr-1 size-4" />
          Back to Agents
        </Button>
        <div className="bg-destructive/10 text-destructive rounded-lg border p-4">{error}</div>
      </div>
    );
  }

  /* Agent not found */
  if (!agent) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            router.push('/agents');
          }}
        >
          <ArrowLeft className="mr-1 size-4" />
          Back to Agents
        </Button>
        <p className="text-muted-foreground text-center">Agent not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Back button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          router.push('/agents');
        }}
      >
        <ArrowLeft className="mr-1 size-4" />
        Back to Agents
      </Button>

      {/* Agent header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Bot className="size-6" />
          <h1 className="text-2xl font-bold">{agent.name}</h1>
        </div>
        {agent.description && <p className="text-muted-foreground">{agent.description}</p>}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            {agent.provider}/{agent.model}
          </Badge>
          <Badge variant={agent.role === 'primary' ? 'default' : 'secondary'}>{agent.role}</Badge>
          <Badge variant={agent.isActive ? 'secondary' : 'outline'}>
            {agent.isActive ? 'Active' : 'Inactive'}
          </Badge>
        </div>
      </div>

      {/* Details section */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <p className="text-muted-foreground mb-1 text-sm font-medium">System Prompt</p>
            <pre className="bg-muted/50 max-h-40 overflow-auto rounded border p-3 text-sm whitespace-pre-wrap">
              {agent.systemPrompt || '—'}
            </pre>
          </div>
          <div>
            <p className="text-muted-foreground mb-1 text-sm font-medium">Provider</p>
            <p className="text-sm">{agent.provider}</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-1 text-sm font-medium">Model</p>
            <p className="text-sm">{agent.model}</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-1 text-sm font-medium">Skills</p>
            <p className="text-sm">{agent.skillIds.length} skill(s)</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-1 text-sm font-medium">Max Tokens per Run</p>
            <p className="text-sm">{agent.maxTokensPerRun.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-1 text-sm font-medium">Created</p>
            <p className="text-sm">{new Date(agent.createdAt).toLocaleDateString()}</p>
          </div>
        </div>
      </div>

      {/* Runs section */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">
          Run History
          {runsMeta && (
            <span className="text-muted-foreground ml-2 text-sm font-normal">
              ({runsMeta.total} total)
            </span>
          )}
        </h2>

        {runs.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border bg-background/30 backdrop-blur-sm p-8 text-center">
            No runs recorded for this agent yet.
          </div>
        ) : (
          <div className="rounded-md border bg-background/30 backdrop-blur-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Input</TableHead>
                  <TableHead>Tokens</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate">
                      {run.input.length > 80 ? `${run.input.slice(0, 80)}...` : run.input}
                    </TableCell>
                    <TableCell>
                      {run.tokenUsage
                        ? `${run.tokenUsage.inputTokens ?? 0} / ${run.tokenUsage.outputTokens ?? 0}`
                        : '—'}
                    </TableCell>
                    <TableCell>{new Date(run.startedAt).toLocaleString()}</TableCell>
                    <TableCell>{formatDuration(run.startedAt, run.completedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
