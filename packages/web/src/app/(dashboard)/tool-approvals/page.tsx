'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CHOICE_LABELS } from '@/lib/approval-labels';
import {
  listStandingApprovals,
  revokeStandingApproval,
  type UserToolApproval,
} from '@/lib/tool-approvals';

export default function ToolApprovalsPage() {
  const [rows, setRows] = useState<UserToolApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revoking, setRevoking] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listStandingApprovals());
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load standing approvals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    setRevoking((s) => new Set(s).add(id));
    // Optimistic removal — restore the row on failure.
    const prev = rows;
    setRows((r) => r.filter((row) => row.id !== id));
    try {
      await revokeStandingApproval(id);
      toast.success('Standing decision revoked');
    } catch (err) {
      setRows(prev);
      toast.error(err instanceof Error ? err.message : 'Failed to revoke');
    } finally {
      setRevoking((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between border-b border-border/60 pb-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Tool Approvals</h1>
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground/70">
              standing
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Your permanent &ldquo;always allow&rdquo; and &ldquo;always deny&rdquo; decisions for
            sensitive tools. Revoke one to be asked again next time an agent uses it.
          </p>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 && !error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <ShieldCheck className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No standing tool decisions.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tool</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead>Since</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.toolName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.resourceKey || '(any)'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.decision === 'denied' ? 'destructive' : 'default'}>
                        {row.decision === 'denied'
                          ? CHOICE_LABELS.deny_always
                          : CHOICE_LABELS.allow_always}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(row.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={revoking.has(row.id)}
                        onClick={() => void revoke(row.id)}
                      >
                        {revoking.has(row.id) && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
