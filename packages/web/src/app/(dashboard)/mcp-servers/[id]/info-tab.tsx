'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { connectionBadge, startMcpOAuth, type McpServerWithConnection } from '@/lib/mcp';
import { ConnectDialog } from '../connect-dialog';
import { ConnectionMenu } from '../connection-menu';

export function InfoTab({
  server,
  onChanged,
}: {
  server: McpServerWithConnection;
  onChanged: () => Promise<void>;
}) {
  const badge = connectionBadge(server);
  const adminDisabled = badge.kind === 'admin-disabled';
  const searchParams = useSearchParams();
  const oauthResult = searchParams.get('oauth') as 'success' | 'error' | null;

  const [connectOpen, setConnectOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [reauthPending, setReauthPending] = useState(false);
  const [reauthError, setReauthError] = useState('');

  const isReauthRequired = server.connection?.status === 'reauth_required';

  async function handleReconnect() {
    setReauthPending(true);
    setReauthError('');
    try {
      const url = await startMcpOAuth(server.id);
      window.location.assign(url);
    } catch (err) {
      setReauthError(err instanceof Error ? err.message : 'Could not start OAuth');
      setReauthPending(false);
    }
  }

  const authLabel =
    server.authType === 'header'
      ? 'Token (header)'
      : server.authType === 'oauth'
        ? 'OAuth'
        : 'None';

  return (
    <div className="flex flex-col gap-4 text-sm">
      {oauthResult === 'success' && (
        <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-green-700 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Connected via OAuth. Visit the Tiers tab to classify tools for your agents.
        </div>
      )}
      {oauthResult === 'error' && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          OAuth authorisation failed. Please try connecting again.
        </div>
      )}

      <dl className="grid grid-cols-[120px_1fr] gap-y-2">
        <dt className="text-muted-foreground">Status</dt>
        <dd className="flex items-center gap-2">
          <Badge variant={badge.kind === 'connected' ? 'default' : 'secondary'}>
            {badge.label}
          </Badge>
          {!adminDisabled && !server.connection && (
            <Button size="sm" onClick={() => setConnectOpen(true)}>
              Connect
            </Button>
          )}
          {!adminDisabled && server.connection && !isReauthRequired && (
            <ConnectionMenu
              server={server}
              onUpdateToken={() => setUpdateOpen(true)}
              onChanged={onChanged}
            />
          )}
          {!adminDisabled && isReauthRequired && (
            <Button
              size="sm"
              variant="destructive"
              disabled={reauthPending}
              onClick={() => void handleReconnect()}
            >
              Reconnect
            </Button>
          )}
        </dd>
        <dt className="text-muted-foreground">URL</dt>
        <dd className="break-all font-mono text-xs">{server.url}</dd>
        <dt className="text-muted-foreground">Transport</dt>
        <dd>{server.transportType}</dd>
        <dt className="text-muted-foreground">Auth</dt>
        <dd>{authLabel}</dd>
      </dl>
      {reauthError && <p className="text-sm text-destructive">{reauthError}</p>}
      {server.setupInstructionsMd && (
        <div>
          <h3 className="mb-1 font-medium">Setup instructions</h3>
          <div className="rounded-md border p-3">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{server.setupInstructionsMd}</ReactMarkdown>
          </div>
        </div>
      )}

      <ConnectDialog
        server={server}
        mode="connect"
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onDone={onChanged}
      />
      <ConnectDialog
        server={server}
        mode="update"
        open={updateOpen}
        onOpenChange={setUpdateOpen}
        onDone={onChanged}
      />
    </div>
  );
}
