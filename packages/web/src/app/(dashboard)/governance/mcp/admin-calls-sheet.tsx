'use client';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { adminGetMcpCalls, type AdminMcpServerDto } from '@/lib/mcp';
import { CallsTab } from '../../mcp-servers/[id]/calls-tab';

export function AdminCallsSheet({
  server,
  onOpenChange,
}: {
  server: AdminMcpServerDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={server !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Call log — {server?.name}</SheetTitle>
          <SheetDescription>All users&apos; tool calls against this server.</SheetDescription>
        </SheetHeader>
        {server && <CallsTab serverId={server.id} fetcher={adminGetMcpCalls} />}
      </SheetContent>
    </Sheet>
  );
}
