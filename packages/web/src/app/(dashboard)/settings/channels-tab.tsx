'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, MoreHorizontal, Plus, Radio, MessageSquare, Globe } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { authFetch } from '@/lib/auth';
import { SuccessDialog } from '@/components/ui/success-dialog';
import { CreateChannelDialog, EditChannelDialog } from './channels-dialogs';

// ------------------------------------------------------------------ //
//  Types (exported for use in dialogs)                                //
// ------------------------------------------------------------------ //

export interface ApiChannel {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
}

interface PaginatedChannels {
  data: ApiChannel[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

// ------------------------------------------------------------------ //
//  Helpers                                                            //
// ------------------------------------------------------------------ //

const channelIcons: Record<string, typeof Radio> = {
  telegram: MessageSquare,
  web: Globe,
};

function ChannelIcon({ type }: { type: string }) {
  const Icon = channelIcons[type] ?? Radio;
  return <Icon className="size-4" />;
}

/**
 * Build a config object from form data, merging with existing config.
 * Blank sensitive fields (e.g. bot token) are omitted to preserve existing values.
 */
function buildConfig(
  type: string,
  form: FormData,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const config = { ...existing };

  if (type === 'telegram') {
    const botToken = form.get('bot_token') as string;
    const mode = form.get('mode') as string;
    if (botToken) config['bot_token'] = botToken;
    if (mode) config['mode'] = mode;
  }

  if (type === 'web') {
    config['enableProgress'] = form.get('enableProgress') === 'on';
    config['enableToolHints'] = form.get('enableToolHints') === 'on';
  }

  return config;
}

// ------------------------------------------------------------------ //
//  Component                                                          //
// ------------------------------------------------------------------ //

export function ChannelsTab() {
  const [channels, setChannels] = useState<ApiChannel[]>([]);
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [editChannel, setEditChannel] = useState<ApiChannel | null>(null);
  const [deleteChannel, setDeleteChannel] = useState<ApiChannel | null>(null);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [res, status] = await Promise.all([
        authFetch<PaginatedChannels>('/admin/channels?limit=100'),
        authFetch<{ connectedIds: string[] }>('/admin/channels/status'),
      ]);
      setChannels(Array.isArray(res.data) ? res.data : []);
      setConnectedIds(new Set(status.connectedIds ?? []));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load channels');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchChannels();
  }, [fetchChannels]);

  async function handleCreate(form: FormData) {
    setSaving(true);
    setError('');
    try {
      const type = form.get('type') as string;
      await authFetch('/admin/channels', {
        method: 'POST',
        body: JSON.stringify({
          type,
          name: form.get('name'),
          config: buildConfig(type, form),
        }),
      });
      setCreateOpen(false);
      await fetchChannels();
      setSuccessMessage(`${form.get('name')} has been added.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create channel');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(channel: ApiChannel) {
    setSaving(true);
    setError('');
    try {
      await authFetch(`/admin/channels/${channel.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !channel.isActive }),
      });
      await fetchChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update channel');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: string, form: FormData) {
    setSaving(true);
    setError('');
    try {
      const channel = channels.find((ch) => ch.id === id);
      const config = buildConfig(channel?.type ?? '', form, channel?.config ?? {});
      await authFetch(`/admin/channels/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: form.get('name'), config }),
      });
      setEditChannel(null);
      await fetchChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update channel');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setSaving(true);
    setError('');
    try {
      await authFetch(`/admin/channels/${id}`, { method: 'DELETE' });
      setDeleteChannel(null);
      await fetchChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete channel');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-end">
        <Button
          size="sm"
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          <Plus className="mr-1 size-4" />
          Add Channel
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : channels.length === 0 ? (
        <div className="rounded-md border bg-background/30 backdrop-blur-sm p-8 text-center text-sm text-muted-foreground">
          No channels configured. Click &quot;Add Channel&quot; to get started.
        </div>
      ) : (
        <div className="rounded-md border bg-background/30 backdrop-blur-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="w-[50px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {channels.map((channel) => (
                <TableRow key={channel.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <ChannelIcon type={channel.type} />
                      {channel.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {channel.type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {channel.isActive ? (
                      connectedIds.has(channel.id) ? (
                        <Badge
                          variant="secondary"
                          className="bg-green-500/15 text-green-600 border-green-500/30"
                        >
                          connected
                        </Badge>
                      ) : (
                        <Badge variant="destructive">disconnected</Badge>
                      )
                    ) : (
                      <Badge variant="outline">disabled</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={channel.isActive}
                      onCheckedChange={() => {
                        void handleToggleActive(channel);
                      }}
                      disabled={saving}
                    />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            setEditChannel(channel);
                          }}
                        >
                          Configure
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onSelect={() => {
                            setDeleteChannel(channel);
                          }}
                        >
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateChannelDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        saving={saving}
        onSubmit={handleCreate}
      />

      <EditChannelDialog
        channel={editChannel}
        onOpenChange={(open) => {
          if (!open) setEditChannel(null);
        }}
        saving={saving}
        onSubmit={handleUpdate}
      />

      <AlertDialog
        open={deleteChannel !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteChannel(null);
        }}
      >
        {deleteChannel && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove Channel</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove <strong>{deleteChannel.name}</strong>? This will
                disconnect the channel and remove its configuration.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  void handleDelete(deleteChannel.id);
                }}
                disabled={saving}
              >
                {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>

      <SuccessDialog
        open={successMessage !== ''}
        onOpenChange={(open) => {
          if (!open) setSuccessMessage('');
        }}
        title="Channel Added"
        description={successMessage}
      />
    </>
  );
}
