'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { authFetch } from '@/lib/auth';
import { useAnimeOnMount, staggerFadeUp, STAGGER } from '@/lib/anime';
import { useAuth } from '@/components/auth-provider';
import { DataPagination, type PaginationMeta } from '@/components/ui/data-pagination';
import { usePaginationParams } from '@/hooks/use-pagination-params';

interface AuditLogEntry {
  id: string;
  userId: string;
  action: string;
  resource: string;
  resourceId: string;
  details: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string };
}

interface PaginatedAuditLogs {
  data: AuditLogEntry[];
  meta: PaginationMeta;
}

const actionColors: Record<string, string> = {
  'agent.run': 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  'agent.create': 'bg-green-500/15 text-green-700 dark:text-green-400',
  'agent.update': 'bg-green-500/15 text-green-700 dark:text-green-400',
  'agent.delete': 'bg-red-500/15 text-red-700 dark:text-red-400',
  'auth.login': 'bg-gray-500/15 text-gray-700 dark:text-gray-400',
  'auth.logout': 'bg-gray-500/15 text-gray-700 dark:text-gray-400',
  'skill.install': 'bg-purple-500/15 text-purple-700 dark:text-purple-400',
  'skill.approve': 'bg-purple-500/15 text-purple-700 dark:text-purple-400',
  'task.create': 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  'user.create': 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  'user.update': 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  'memory.share': 'bg-pink-500/15 text-pink-700 dark:text-pink-400',
  'config.update': 'bg-red-500/15 text-red-700 dark:text-red-400',
};

function getActionColor(action: string): string {
  return actionColors[action] ?? 'bg-muted text-muted-foreground';
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatDetails(details: Record<string, unknown>): string {
  if (!details || Object.keys(details).length === 0) return '—';
  return Object.entries(details)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(', ');
}

export default function AuditLogsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const { page, limit, setPage, setLimit } = usePaginationParams();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({
    total: 0,
    page: 1,
    limit,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (actionFilter) params.set('action', actionFilter);
      if (resourceFilter) params.set('resource', resourceFilter);

      const res = await authFetch<PaginatedAuditLogs>(`/api/v1/audit?${params.toString()}`);
      setLogs(Array.isArray(res.data) ? res.data : []);
      setMeta(
        res.meta ?? {
          total: 0,
          page: 1,
          limit,
          totalPages: 0,
        },
      );
    } catch (e) {
      setLogs([]);
      toast.error(e instanceof Error ? e.message : 'Failed to load audit logs', {
        id: 'audit-fetch',
      });
    } finally {
      setLoading(false);
    }
  }, [page, limit, actionFilter, resourceFilter]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  useAnimeOnMount(staggerFadeUp('[data-animate="audit-rows"] tr', { stagger: STAGGER.tight }));

  // Client-side search within loaded results
  const filteredLogs = searchQuery
    ? logs.filter(
        (log) =>
          log.user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
          log.resource.toLowerCase().includes(searchQuery.toLowerCase()) ||
          log.resourceId.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : logs;

  // Unique actions for filter dropdown (from known set)
  const knownActions = [
    'agent.run',
    'agent.create',
    'agent.update',
    'agent.delete',
    'auth.login',
    'auth.logout',
    'skill.install',
    'skill.approve',
    'task.create',
    'task.update',
    'user.create',
    'user.update',
    'memory.share',
    'config.update',
  ];

  const knownResources = [
    'AgentDefinition',
    'AgentRun',
    'User',
    'Session',
    'Policy',
    'Channel',
    'Skill',
    'MemoryItem',
    'Group',
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Audit Logs</h1>
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground/70">
            ledger
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Immutable record of all actions and events in your workspace.
          {!isAdmin && ' Showing your actions only.'}
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search logs..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
            }}
          />
        </div>
        <Select
          value={actionFilter || 'all'}
          onValueChange={(v) => {
            setActionFilter(v === 'all' ? '' : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]" aria-label="Filter by action">
            <SelectValue placeholder="All Actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            {knownActions.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={resourceFilter || 'all'}
          onValueChange={(v) => {
            setResourceFilter(v === 'all' ? '' : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]" aria-label="Filter by resource">
            <SelectValue placeholder="All Resources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Resources</SelectItem>
            {knownResources.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{meta.total} total entries</span>
      </div>

      {/* Logs table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="rounded-md border bg-background/30 backdrop-blur-sm p-8 text-center text-sm text-muted-foreground">
          No audit log entries found.
        </div>
      ) : (
        <div className="rounded-md border bg-background/30 backdrop-blur-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody data-animate="audit-rows">
              {filteredLogs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {formatTimestamp(log.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div>
                      <span className="font-medium">{log.user.name}</span>
                      {log.ipAddress && (
                        <span className="ml-2 text-xs text-muted-foreground">{log.ipAddress}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={getActionColor(log.action)}>
                      {log.action}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-sm">{log.resource}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {log.resourceId.length > 16
                          ? `${log.resourceId.slice(0, 16)}...`
                          : log.resourceId}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[300px] truncate text-sm text-muted-foreground">
                    {formatDetails(log.details)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!loading && logs.length > 0 ? (
        <DataPagination
          meta={meta}
          onPageChange={setPage}
          onLimitChange={setLimit}
          label="log entries"
        />
      ) : null}
    </div>
  );
}
