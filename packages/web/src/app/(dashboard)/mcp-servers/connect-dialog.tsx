'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import {
  connectMcpServer,
  updateMcpConnection,
  autoSortConnectionTiers,
  startMcpOAuth,
  type McpServerWithConnection,
} from '@/lib/mcp';

type Phase = 'form' | 'sorting' | 'done';

interface SortSummary {
  recommended: number;
  optional: number;
  off: number;
}

/**
 * Connect to a server (mode="connect") or replace the stored token
 * (mode="update").
 *
 * Connect mode runs in three phases: the credential form, an auto-sort step
 * that classifies the freshly discovered catalog into tiers, and a completion
 * screen summarising the result. Auto-sort persists `recommended` server-side,
 * which (via auto-bind) is what makes the server's tools available to the
 * user's agents — so doing it inline removes the otherwise-required trip to the
 * Tiers tab. Update mode keeps the original single-step behaviour (tiers are
 * already curated; replacing a token must not re-sort).
 */
export function ConnectDialog({
  server,
  mode,
  open,
  onOpenChange,
  onDone,
}: {
  server: McpServerWithConnection;
  mode: 'connect' | 'update';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => Promise<void>;
}) {
  const router = useRouter();
  const [credential, setCredential] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [summary, setSummary] = useState<SortSummary | null>(null);
  const [sortFailed, setSortFailed] = useState(false);
  const needsCredential = server.authType === 'header';
  const isOAuth = server.authType === 'oauth';

  // Reset to a clean form whenever the dialog (re)opens.
  useEffect(() => {
    if (open) {
      setCredential('');
      setError('');
      setPhase('form');
      setSummary(null);
      setSortFailed(false);
    }
  }, [open]);

  async function submit() {
    setPending(true);
    setError('');
    try {
      if (mode === 'update') {
        await updateMcpConnection(server.connection!.id, { credential });
        setCredential('');
        onOpenChange(false);
        await onDone();
        return;
      }

      // Connect, then auto-sort the discovered catalog into tiers.
      const connection = await connectMcpServer(
        server.id,
        needsCredential ? credential : undefined,
      );
      setCredential('');
      setPhase('sorting');
      try {
        const tiers = await autoSortConnectionTiers(connection.id);
        setSummary({
          recommended: tiers.recommended.length,
          optional: tiers.optional.length,
          off: tiers.off.length,
        });
      } catch {
        // Connect already succeeded — never roll it back. The user can run
        // auto-sort manually from the Tiers tab.
        setSortFailed(true);
      }
      setPhase('done');
      await onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("You're already connected to this server.");
      } else {
        setError(err instanceof Error ? err.message : 'Connection failed');
      }
    } finally {
      setPending(false);
    }
  }

  async function startOAuth() {
    setPending(true);
    setError('');
    try {
      const url = await startMcpOAuth(server.id);
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start OAuth');
      setPending(false);
    }
  }

  function goToTiers() {
    onOpenChange(false);
    router.push(`/mcp-servers/${server.id}?tab=tiers`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {phase === 'done' ? (
          <DonePhase
            serverName={server.name}
            summary={summary}
            sortFailed={sortFailed}
            onClose={() => onOpenChange(false)}
            onReviewTiers={goToTiers}
          />
        ) : phase === 'sorting' ? (
          <SortingPhase serverName={server.name} />
        ) : isOAuth ? (
          <>
            <DialogHeader>
              <DialogTitle>Connect {server.name}</DialogTitle>
              <DialogDescription>
                This server uses OAuth. You&apos;ll be redirected to the provider to authorise
                access, then returned here automatically.
              </DialogDescription>
            </DialogHeader>

            {server.setupInstructionsMd && (
              <div className="prose prose-sm dark:prose-invert max-h-48 overflow-y-auto rounded-md border p-3">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {server.setupInstructionsMd}
                </ReactMarkdown>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={() => void startOAuth()} disabled={pending}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Connect with provider
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {mode === 'connect' ? `Connect ${server.name}` : `Update token for ${server.name}`}
              </DialogTitle>
              <DialogDescription>
                Your credential is verified against the server, then stored encrypted. Calls made by
                your agents use your identity.
              </DialogDescription>
            </DialogHeader>

            {server.setupInstructionsMd && (
              <div className="prose prose-sm dark:prose-invert max-h-48 overflow-y-auto rounded-md border p-3">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {server.setupInstructionsMd}
                </ReactMarkdown>
              </div>
            )}

            {needsCredential ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="mcp-credential">Credential</Label>
                <Input
                  id="mcp-credential"
                  type="password"
                  placeholder={server.credentialFormat ?? 'token'}
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                  autoComplete="off"
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                This server requires no credential — connecting just enables it for your agents.
              </p>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                Cancel
              </Button>
              <Button
                onClick={() => void submit()}
                disabled={pending || (needsCredential && !credential)}
              >
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Verify &amp; Save
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SortingPhase({ serverName }: { serverName: string }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Connected {serverName}</DialogTitle>
        <DialogDescription>Auto-sorting tools into tiers…</DialogDescription>
      </DialogHeader>
      <div className="flex items-center justify-center gap-3 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Classifying the server&apos;s tools…
      </div>
    </>
  );
}

function DonePhase({
  serverName,
  summary,
  sortFailed,
  onClose,
  onReviewTiers,
}: {
  serverName: string;
  summary: SortSummary | null;
  sortFailed: boolean;
  onClose: () => void;
  onReviewTiers: () => void;
}) {
  const noneRecommended = !sortFailed && (summary?.recommended ?? 0) === 0;
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-primary" />
          Connected {serverName}
        </DialogTitle>
        <DialogDescription>
          {sortFailed
            ? "Auto-sort didn't finish — run it on the Tiers tab."
            : noneRecommended
              ? 'Connected, but no tools were recommended yet. Set them on the Tiers tab.'
              : 'Auto-sort complete. Adjust anytime on the Tiers tab.'}
        </DialogDescription>
      </DialogHeader>

      {summary && !sortFailed && (
        <div className="flex gap-2 py-2 text-sm">
          <span className="rounded-md bg-primary/10 px-2.5 py-1 font-medium text-primary">
            {summary.recommended} recommended
          </span>
          <span className="rounded-md bg-muted px-2.5 py-1 text-muted-foreground">
            {summary.optional} optional
          </span>
          <span className="rounded-md bg-muted px-2.5 py-1 text-muted-foreground">
            {summary.off} off
          </span>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onReviewTiers}>
          Review tiers
        </Button>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </>
  );
}
