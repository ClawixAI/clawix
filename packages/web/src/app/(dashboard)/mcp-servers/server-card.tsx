'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { connectionBadge, type McpServerWithConnection } from '@/lib/mcp';
import { ConnectionMenu } from './connection-menu';

const BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  connected: 'default',
  'not-connected': 'outline',
  'disabled-by-user': 'secondary',
  attention: 'destructive',
  'admin-disabled': 'secondary',
};

export function ServerCard({
  server,
  toolCount,
  onConnect,
  onUpdateToken,
  onChanged,
}: {
  server: McpServerWithConnection;
  toolCount?: number;
  onConnect: () => void;
  onUpdateToken: () => void;
  onChanged: () => Promise<void>;
}) {
  const badge = connectionBadge(server);
  const adminDisabled = badge.kind === 'admin-disabled';

  return (
    <Card className={adminDisabled ? 'opacity-60' : undefined}>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            {server.name}
            <Badge variant={BADGE_VARIANT[badge.kind]}>{badge.label}</Badge>
          </CardTitle>
          <CardDescription>
            {server.authType === 'header' ? 'Token auth' : 'No auth'} · {server.transportType}
            {typeof toolCount === 'number' ? ` · ${toolCount} tools` : ''}
          </CardDescription>
        </div>
        {!adminDisabled && server.connection && (
          <ConnectionMenu server={server} onUpdateToken={onUpdateToken} onChanged={onChanged} />
        )}
      </CardHeader>
      <CardContent className="flex gap-2">
        {!adminDisabled && !server.connection && (
          <Button size="sm" onClick={onConnect}>
            Connect
          </Button>
        )}
        {!adminDisabled && (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/mcp-servers/${server.id}`}>Open</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
