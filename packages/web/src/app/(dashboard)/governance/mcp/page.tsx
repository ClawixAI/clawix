'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, MoreHorizontal, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  adminDeleteMcpServer,
  adminListMcpServers,
  adminUpdateMcpServer,
  type AdminMcpServerDto,
} from '@/lib/mcp';
import { AdminCallsSheet } from './admin-calls-sheet';
import { ImportDialog } from './import-dialog';

export default function McpGovernancePage() {
  const [servers, setServers] = useState<AdminMcpServerDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [editServer, setEditServer] = useState<AdminMcpServerDto | null>(null);
  const [callsServer, setCallsServer] = useState<AdminMcpServerDto | null>(null);
  const [deleteServer, setDeleteServer] = useState<AdminMcpServerDto | null>(null);

  const fetchServers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setServers(await adminListMcpServers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load servers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchServers();
  }, [fetchServers]);

  async function toggleEnabled(server: AdminMcpServerDto) {
    try {
      await adminUpdateMcpServer(server.id, { enabled: !server.enabled });
      await fetchServers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function confirmDelete() {
    if (!deleteServer) return;
    try {
      await adminDeleteMcpServer(deleteServer.id);
      setDeleteServer(null);
      await fetchServers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">MCP Governance</h1>
          <p className="text-sm text-muted-foreground">
            Import remote MCP servers into the org catalog and manage their availability.
          </p>
        </div>
        <Button onClick={() => setImportOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Import Server
        </Button>
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
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead>Connections</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {servers.map((server) => (
              <TableRow key={server.id}>
                <TableCell className="font-medium">{server.name}</TableCell>
                <TableCell className="max-w-56 truncate font-mono text-xs">{server.url}</TableCell>
                <TableCell>
                  <Switch
                    checked={server.enabled}
                    onCheckedChange={() => void toggleEnabled(server)}
                    aria-label={`Toggle ${server.name}`}
                  />
                </TableCell>
                <TableCell>{server.connectionCount}</TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Server actions">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setEditServer(server)}>
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setCallsServer(server)}>
                        Call log
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => setDeleteServer(server)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {servers.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  No servers imported yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <ImportDialog
        // key forces a remount per open so error/authType/field state never
        // leaks across reopens (same pattern as agents-list.tsx CreateAgentDialog)
        key={importOpen ? 'open' : 'closed'}
        server={null}
        open={importOpen}
        onOpenChange={setImportOpen}
        onDone={fetchServers}
      />
      {editServer && (
        <ImportDialog
          server={editServer}
          open={true}
          onOpenChange={(open) => {
            if (!open) setEditServer(null);
          }}
          onDone={fetchServers}
        />
      )}
      <AdminCallsSheet
        server={callsServer}
        onOpenChange={(open) => !open && setCallsServer(null)}
      />

      <AlertDialog
        open={deleteServer !== null}
        onOpenChange={(open) => !open && setDeleteServer(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteServer?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the server, its cached tool catalog, and ALL users&apos; connections to
              it. Agents bound to it lose its tools.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
