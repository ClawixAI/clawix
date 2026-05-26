'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { MoreHorizontal, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { DataPagination, type PaginationMeta } from '@/components/ui/data-pagination';
import { usePaginationParams } from '@/hooks/use-pagination-params';
import { DeleteTaskDialog, TaskFormDialog } from './tasks-dialogs';
import type { ApiSchedule, ApiTask } from './tasks-types';

interface PaginatedTasks {
  readonly data: readonly ApiTask[];
  readonly meta: PaginationMeta;
}

interface TasksResponse {
  readonly success: boolean;
  readonly data: PaginatedTasks;
}

function formatSchedule(schedule: ApiSchedule): string {
  if (schedule.type === 'cron') {
    return schedule.tz ? `${schedule.expression} (${schedule.tz})` : schedule.expression;
  }
  if (schedule.type === 'every') return `every ${schedule.interval}`;
  return `daily at ${schedule.time}`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function lastRunDotClass(status: string): string {
  if (status === 'completed') return 'bg-emerald-500';
  if (status === 'failed') return 'bg-destructive';
  if (status === 'running') return 'bg-amber-500 animate-pulse';
  return 'bg-muted-foreground/40';
}

export default function TasksPage() {
  const { page, limit, setPage, setLimit } = usePaginationParams();
  const [tasks, setTasks] = useState<readonly ApiTask[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({
    total: 0,
    page: 1,
    limit,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ApiTask | null>(null);
  const [deleting, setDeleting] = useState<ApiTask | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch<TasksResponse>(`/api/v1/tasks?page=${page}&limit=${limit}`);
      // Sort enabled first within the current page, preserving the API's
      // createdAt-desc order inside each group via a stable index tiebreak.
      const sorted = [...res.data.data]
        .map((t, i) => ({ t, i }))
        .sort((a, b) => Number(b.t.enabled) - Number(a.t.enabled) || a.i - b.i)
        .map((x) => x.t);
      setTasks(sorted);
      setMeta(res.data.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schedules');
    } finally {
      setLoading(false);
    }
  }, [page, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggleEnabled(task: ApiTask) {
    try {
      await authFetch(`/api/v1/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !task.enabled }),
      });
      toast.success(task.enabled ? 'Schedule disabled' : 'Schedule enabled');
      await load();
    } catch (err) {
      toast.error('Failed to update schedule', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    }
  }

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(task: ApiTask) {
    setEditing(task);
    setFormOpen(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Schedules</h1>
          <p className="text-sm text-muted-foreground">
            Manage recurring agent runs. Each schedule runs an agent on a cron, interval, or daily
            cadence.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="mr-2 size-4" />
          New schedule
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Schedule</TableHead>
              <TableHead>Last Run</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Next Run</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-destructive">
                  {error}
                </TableCell>
              </TableRow>
            ) : tasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No schedules yet. Click <span className="font-medium">New schedule</span> to
                  create one.
                </TableCell>
              </TableRow>
            ) : (
              tasks.map((task) => (
                <TableRow key={task.id} className={!task.enabled ? 'opacity-50' : undefined}>
                  <TableCell className="font-medium">
                    <Link href={`/tasks/${task.id}`} className="hover:underline">
                      {task.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {formatSchedule(task.schedule)}
                    </code>
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    <span className="inline-flex items-center gap-1.5">
                      {task.lastStatus && (
                        <span
                          aria-label={`Last run ${task.lastStatus}`}
                          title={`Last run: ${task.lastStatus}`}
                          className={`inline-block size-1.5 rounded-full ${lastRunDotClass(task.lastStatus)}`}
                        />
                      )}
                      {formatDateTime(task.lastRunAt)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={task.enabled ? 'default' : 'secondary'}>
                      {task.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {task.enabled ? formatDateTime(task.nextRunAt) : '—'}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Actions for ${task.name}`}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            openEdit(task);
                          }}
                        >
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            void handleToggleEnabled(task);
                          }}
                        >
                          {task.enabled ? 'Disable' : 'Enable'}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => {
                            setDeleting(task);
                          }}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {!loading && !error && tasks.length > 0 ? (
        <DataPagination
          meta={meta}
          onPageChange={setPage}
          onLimitChange={setLimit}
          label="schedules"
        />
      ) : null}

      <TaskFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        task={editing}
        onSaved={() => {
          void load();
        }}
      />
      <DeleteTaskDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        task={deleting}
        onDeleted={() => {
          void load();
        }}
      />
    </div>
  );
}
