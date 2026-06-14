'use client';

import { Loader2 } from 'lucide-react';
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
import { useMcpCalls } from '@/hooks/use-mcp';
import { getMcpCalls, type McpCallsPage } from '@/lib/mcp';

export function CallsTab({
  serverId,
  fetcher = getMcpCalls,
}: {
  serverId: string;
  fetcher?: (serverId: string, cursor?: string) => Promise<McpCallsPage>;
}) {
  const { items, nextCursor, loading, errorMessage, loadMore } = useMcpCalls(serverId, fetcher);

  if (errorMessage) return <p className="text-sm text-destructive">{errorMessage}</p>;

  return (
    <div className="flex flex-col gap-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Tool</TableHead>
            <TableHead>Agent run</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Duration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="whitespace-nowrap">
                {new Date(row.createdAt).toLocaleString()}
              </TableCell>
              <TableCell className="font-mono text-xs">{row.details.toolName ?? '—'}</TableCell>
              <TableCell className="font-mono text-xs">{row.details.agentRunId ?? '—'}</TableCell>
              <TableCell>
                <Badge variant={row.details.isError ? 'destructive' : 'default'}>
                  {row.details.isError ? 'error' : 'ok'}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                {typeof row.details.durationMs === 'number' ? `${row.details.durationMs} ms` : '—'}
              </TableCell>
            </TableRow>
          ))}
          {!loading && items.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                No calls yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}
      {nextCursor && !loading && (
        <Button variant="outline" size="sm" onClick={() => void loadMore()}>
          Load more
        </Button>
      )}
    </div>
  );
}
