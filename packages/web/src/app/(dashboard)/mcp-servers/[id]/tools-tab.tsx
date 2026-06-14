'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useMcpTools } from '@/hooks/use-mcp';

export function ToolsTab({ serverId }: { serverId: string }) {
  const { data: tools, loading, errorMessage } = useMcpTools(serverId);

  if (loading)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading tools…
      </div>
    );
  if (errorMessage) return <p className="text-sm text-destructive">{errorMessage}</p>;

  return (
    <ul className="flex flex-col gap-3">
      {tools.map((tool) => (
        <li key={tool.id} className="rounded-md border p-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm">{tool.name}</span>
            {tool.scanFlagged && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-3 w-3" /> flagged
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  Description failed the prompt-injection scan
                  {tool.scanReason ? `: ${tool.scanReason}` : ''}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{tool.description || '—'}</p>
        </li>
      ))}
      {tools.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No tools — connect to this server (from the catalog) to discover its tools, or refresh an
          existing connection.
        </p>
      )}
    </ul>
  );
}
