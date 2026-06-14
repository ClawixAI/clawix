'use client';

import { useState } from 'react';
import { Loader2, Plug } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useMcpServers } from '@/hooks/use-mcp';
import type { McpServerWithConnection } from '@/lib/mcp';
import { ConnectDialog } from './connect-dialog';
import { ServerCard } from './server-card';

export default function McpServersPage() {
  const { data: servers, loading, errorStatus, errorMessage, refetch } = useMcpServers();
  const [dialog, setDialog] = useState<{
    server: McpServerWithConnection;
    mode: 'connect' | 'update';
  } | null>(null);

  if (errorStatus === 403) {
    return (
      <div className="flex flex-col items-center gap-2 py-24 text-center">
        <Plug className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold">MCP isn&apos;t enabled for your plan</h2>
        <p className="text-sm text-muted-foreground">Contact your administrator to enable it.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between border-b border-border/60 pb-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">MCP Servers</h1>
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground/70">
              tools
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Connect third-party tool servers with your own credentials, then pick tools per agent in
            the agent settings.
          </p>
        </div>
      </div>

      {errorMessage && errorStatus !== 403 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6 text-sm text-destructive">{errorMessage}</CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading servers…
        </div>
      ) : servers.length === 0 && !errorMessage ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No MCP servers imported yet. Admins can import servers under Governance → MCP
            Governance.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              onConnect={() => setDialog({ server, mode: 'connect' })}
              onUpdateToken={() => setDialog({ server, mode: 'update' })}
              onChanged={refetch}
            />
          ))}
        </div>
      )}

      {dialog && (
        <ConnectDialog
          server={dialog.server}
          mode={dialog.mode}
          open={true}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          onDone={refetch}
        />
      )}
    </div>
  );
}
