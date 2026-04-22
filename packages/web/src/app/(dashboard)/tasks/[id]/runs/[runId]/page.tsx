'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface RunMessage {
  id: string;
  role: string;
  content: string;
  ordering: number;
  toolCallId: string | null;
  toolCalls: unknown;
}

interface Run {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  output: string | null;
  error: string | null;
  tokenUsage: { inputTokens?: number; outputTokens?: number };
}

interface MessagesResponse {
  success: boolean;
  data: { run: Run; messages: RunMessage[] };
}

export default function RunDetailPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const router = useRouter();
  const [run, setRun] = useState<Run | null>(null);
  const [messages, setMessages] = useState<RunMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const resp = await authFetch<MessagesResponse>(`/api/v1/tasks/${id}/runs/${runId}/messages`);
      setRun(resp.data.run);
      setMessages(resp.data.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load run.');
    } finally {
      setLoading(false);
    }
  }, [id, runId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (error) return <div className="p-6 text-destructive">Error: {error}</div>;
  if (!run) return <div className="p-6">Run not found.</div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Run</h1>
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
        </div>
        <Button variant="outline" onClick={() => router.push(`/tasks/${id}`)}>
          Back to Task
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Started: </span>
            {new Date(run.startedAt).toLocaleString()}
          </div>
          <div>
            <span className="text-muted-foreground">Completed: </span>
            {run.completedAt ? new Date(run.completedAt).toLocaleString() : '—'}
          </div>
          <div>
            <span className="text-muted-foreground">Duration: </span>
            {run.durationMs != null ? `${run.durationMs}ms` : '—'}
          </div>
          <div>
            <span className="text-muted-foreground">Tokens: </span>
            in {run.tokenUsage?.inputTokens ?? 0} / out {run.tokenUsage?.outputTokens ?? 0}
          </div>
          {run.error && (
            <div className="text-destructive">
              <span className="text-muted-foreground">Error: </span>
              {run.error}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages recorded.</p>
          ) : (
            <ul className="space-y-3">
              {messages.map((msg) => (
                <li key={msg.id} className="rounded border border-border p-3">
                  <div className="mb-1 text-xs uppercase text-muted-foreground">{msg.role}</div>
                  <pre className="whitespace-pre-wrap text-sm">{msg.content}</pre>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
