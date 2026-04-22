'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface TaskRunRow {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  error: string | null;
  output: string | null;
  tokenUsage: { inputTokens?: number; outputTokens?: number };
}

interface Task {
  id: string;
  name: string;
  prompt: string;
  schedule: unknown;
  enabled: boolean;
  lastStatus: string | null;
  nextRunAt: string | null;
}

interface TaskResponse {
  success: boolean;
  data: Task;
}

interface TaskRunsResponse {
  success: boolean;
  data: { runs: TaskRunRow[] };
}

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const [runs, setRuns] = useState<TaskRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [taskResp, runsResp] = await Promise.all([
        authFetch<TaskResponse>(`/api/v1/tasks/${id}`),
        authFetch<TaskRunsResponse>(`/api/v1/tasks/${id}/runs?limit=20`),
      ]);
      setTask(taskResp.data);
      setRuns(runsResp.data.runs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load task');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (error) return <div className="p-6 text-destructive">{error}</div>;
  if (!task) return <div className="p-6">Task not found.</div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{task.name}</h1>
          <p className="text-sm text-muted-foreground">Task details and run history.</p>
        </div>
        <Button variant="outline" onClick={() => router.push('/tasks')}>
          Back to Tasks
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Task Info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Prompt: </span>
            {task.prompt}
          </div>
          <div>
            <span className="text-muted-foreground">Schedule: </span>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {JSON.stringify(task.schedule)}
            </code>
          </div>
          <div>
            <span className="text-muted-foreground">Enabled: </span>
            {task.enabled ? 'yes' : 'no'}
          </div>
          <div>
            <span className="text-muted-foreground">Next run: </span>
            {task.nextRunAt ?? '—'}
          </div>
          {task.lastStatus && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Last status: </span>
              <Badge
                variant={
                  task.lastStatus === 'completed'
                    ? 'default'
                    : task.lastStatus === 'failed'
                      ? 'destructive'
                      : 'secondary'
                }
              >
                {task.lastStatus}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Runs</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <ul className="divide-y">
              {runs.map((run) => (
                <li key={run.id} className="py-3">
                  <Link
                    href={`/tasks/${id}/runs/${run.id}`}
                    className="flex items-center justify-between hover:underline"
                  >
                    <div className="flex items-center gap-3">
                      <Badge
                        variant={
                          run.status === 'completed'
                            ? 'default'
                            : run.status === 'failed'
                              ? 'destructive'
                              : 'secondary'
                        }
                      >
                        {run.status}
                      </Badge>
                      <span className="text-sm">{new Date(run.startedAt).toLocaleString()}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {run.durationMs != null ? `${run.durationMs}ms` : ''}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
