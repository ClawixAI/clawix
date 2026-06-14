'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { listMcpServers, type McpServerWithConnection } from '@/lib/mcp';
import { parseTab, type McpDetailTab } from './parse-tab';
import { InfoTab } from './info-tab';
import { ToolsTab } from './tools-tab';
import { TiersTab } from './tiers-tab';
import { CallsTab } from './calls-tab';

export default function McpServerDetailPage() {
  const params = useParams();
  const rawId = params['id'];
  const id = Array.isArray(rawId) ? (rawId[0] ?? '') : (rawId ?? '');

  const router = useRouter();
  const search = useSearchParams();
  const tab = parseTab(search.get('tab'));

  const [server, setServer] = useState<McpServerWithConnection | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // No single-server GET endpoint — the list payload is small; find by id.
      const servers = await listMcpServers();
      const found = servers.find((s) => s.id === id) ?? null;
      if (!found) {
        toast.error('Server not found');
        router.replace('/mcp-servers');
        return;
      }
      setServer(found);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load server');
      router.replace('/mcp-servers');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const setTab = (next: McpDetailTab) => {
    const qs = new URLSearchParams(search.toString());
    qs.set('tab', next);
    router.replace(`/mcp-servers/${id}?${qs.toString()}`);
  };

  if (loading || !server) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild aria-label="Back to catalog">
          <Link href="/mcp-servers">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">{server.name}</h1>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as McpDetailTab)}>
        <TabsList>
          <TabsTrigger value="info">Info</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="tiers">Tiers</TabsTrigger>
          <TabsTrigger value="calls">Call Log</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'info' && <InfoTab server={server} onChanged={load} />}
      {tab === 'tools' && <ToolsTab serverId={server.id} />}
      {tab === 'tiers' && (
        <TiersTab serverId={server.id} connectionId={server.connection?.id ?? null} />
      )}
      {tab === 'calls' && <CallsTab serverId={server.id} />}
    </div>
  );
}
