'use client';

import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  deleteMcpConnection,
  refreshMcpConnection,
  updateMcpConnection,
  type McpServerWithConnection,
} from '@/lib/mcp';

export function ConnectionMenu({
  server,
  onUpdateToken,
  onChanged,
}: {
  server: McpServerWithConnection;
  onUpdateToken: () => void;
  onChanged: () => Promise<void>;
}) {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const connection = server.connection;
  if (!connection) return null;
  const disabled = connection.status === 'disabled';

  async function toggleDisabled() {
    await updateMcpConnection(connection!.id, { status: disabled ? 'active' : 'disabled' });
    await onChanged();
  }

  async function disconnect() {
    await deleteMcpConnection(connection!.id);
    setConfirmDisconnect(false);
    await onChanged();
  }

  async function refreshTools() {
    try {
      const tools = await refreshMcpConnection(connection!.id);
      toast.success(`Refreshed: ${tools.length} tools`);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refresh failed');
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Connection actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => void toggleDisabled()}>
            {disabled ? 'Enable' : 'Disable'}
          </DropdownMenuItem>
          {server.authType === 'header' && (
            <DropdownMenuItem onClick={onUpdateToken}>Update token</DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => void refreshTools()}>Refresh tools</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={() => setConfirmDisconnect(true)}>
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {server.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Your stored credential is deleted and agents bound to this server lose its tools until
              you reconnect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void disconnect()}>Disconnect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
