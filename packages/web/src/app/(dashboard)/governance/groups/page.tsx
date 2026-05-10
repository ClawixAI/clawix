'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, RotateCcw, Trash2, UserPlus, LogOut } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/components/auth-provider';
import { InvitePicker, type PickedUser } from './invite-picker';

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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import {
  groupsApi,
  type Group,
  type GroupDetail,
  type GroupInvite,
  type GroupMembership,
} from '@/lib/api/groups';

type LoadState = 'idle' | 'loading' | 'error';

export default function GroupsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [memberships, setMemberships] = useState<GroupMembership[]>([]);
  const [sentInvites, setSentInvites] = useState<GroupInvite[]>([]);
  const [deletedGroups, setDeletedGroups] = useState<(Group & { deletedAt: string })[]>([]);
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const [activeGroup, setActiveGroup] = useState<GroupMembership | null>(null);
  const [confirm, setConfirm] = useState<
    | { kind: 'delete-group'; groupId: string; groupName: string }
    | { kind: 'leave-group'; groupId: string; groupName: string }
    | null
  >(null);

  const refresh = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const [mine, sent, deleted] = await Promise.all([
        groupsApi.listMine(),
        groupsApi.listInvites('sent'),
        // Deleted-groups listing is admin-only on the API; skip it for
        // non-admins so the page doesn't show a 403 every refresh.
        isAdmin
          ? groupsApi.listDeleted()
          : Promise.resolve({ data: [] as (Group & { deletedAt: string })[] }),
      ]);
      setMemberships(mine.items);
      setSentInvites(sent.items);
      setDeletedGroups(deleted.data);
      setState('idle');
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, [isAdmin]);

  const handleRestore = useCallback(
    async (group: Group & { deletedAt: string }) => {
      setRestoringId(group.id);
      try {
        await groupsApi.restore(group.id);
        toast.success(`Restored "${group.name}"`);
        await refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to restore group');
      } finally {
        setRestoringId(null);
      }
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The notification bell dispatches `clawix:invite-responded` on every
  // GROUP_INVITE_RESPONSE WS event. Refresh so the Sent invites tab
  // reflects the new ACCEPTED / REJECTED state without a manual reload.
  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener('clawix:invite-responded', handler);
    return () => window.removeEventListener('clawix:invite-responded', handler);
  }, [refresh]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      await groupsApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setName('');
      setDescription('');
      setCreateOpen(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  }, [name, description, refresh]);

  const handleConfirm = useCallback(async () => {
    if (!confirm) return;
    try {
      if (confirm.kind === 'delete-group') {
        await groupsApi.delete(confirm.groupId);
      } else if (confirm.kind === 'leave-group') {
        await groupsApi.leave(confirm.groupId);
      }
      setConfirm(null);
      setActiveGroup(null);
      await refresh();
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Action failed';
      setError(msg);
      setConfirm(null);
    }
  }, [confirm, refresh]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between border-b border-border/60 pb-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Groups</h1>
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground/70">
              collaboration
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Collaboration namespaces for shared memory. Anyone can create one and invite others.
          </p>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New group
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a group</DialogTitle>
              <DialogDescription>
                You'll automatically be set as the owner. You can invite members afterwards.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="group-name">Name</Label>
                <Input
                  id="group-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Platform team"
                  maxLength={128}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="group-description">Description (optional)</Label>
                <Textarea
                  id="group-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this group for?"
                  maxLength={500}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={!name.trim() || creating}>
                {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {error ? (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="mine">
        <TabsList>
          <TabsTrigger value="mine">My groups ({memberships.length})</TabsTrigger>
          <TabsTrigger value="sent">Sent invites ({sentInvites.length})</TabsTrigger>
          {isAdmin ? (
            <TabsTrigger value="deleted">Deleted ({deletedGroups.length})</TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="mine" className="mt-4">
          {state === 'loading' ? (
            <Card>
              <CardContent className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </CardContent>
            </Card>
          ) : memberships.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                You're not in any groups yet. Create one with the button above.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {memberships.map((m) => {
                const isOwner = m.role === 'OWNER';
                return (
                  <Card
                    key={m.groupId}
                    className={`group cursor-pointer border-l-[3px] transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.02] ${
                      isOwner
                        ? 'border-l-amber-500/70 hover:border-amber-500/50 hover:bg-amber-500/5 hover:shadow-[0_10px_30px_-10px_rgba(245,158,11,0.4)]'
                        : 'border-l-sky-500/50 hover:border-sky-500/40 hover:bg-sky-500/5 hover:shadow-[0_10px_30px_-10px_rgba(56,189,248,0.35)]'
                    }`}
                    onClick={() => setActiveGroup(m)}
                  >
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between gap-2 text-base">
                        <span className="truncate font-semibold tracking-tight">
                          {m.group.name}
                        </span>
                        <Badge
                          className={
                            isOwner
                              ? 'border-amber-500/40 bg-amber-500/15 text-amber-400'
                              : 'border-sky-500/40 bg-sky-500/15 text-sky-400'
                          }
                          variant="outline"
                        >
                          {m.role}
                        </Badge>
                      </CardTitle>
                      {m.group.description ? (
                        <CardDescription className="line-clamp-2">
                          {m.group.description}
                        </CardDescription>
                      ) : null}
                    </CardHeader>
                    <CardContent className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="font-mono">
                        {m.group._count.members} member{m.group._count.members === 1 ? '' : 's'}
                      </span>
                      <span className="text-muted-foreground/40">·</span>
                      <span>joined {new Date(m.joinedAt).toLocaleDateString()}</span>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="sent" className="mt-4">
          {sentInvites.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                You haven't sent any invites.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="space-y-2 pt-6">
                {sentInvites.map((inv) => (
                  <SentInviteRow key={inv.id} invite={inv} onChange={refresh} />
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {isAdmin ? (
          <TabsContent value="deleted" className="mt-4">
            {deletedGroups.length === 0 ? (
              <Card>
                <CardContent className="pt-6 text-sm text-muted-foreground">
                  No soft-deleted groups. Restoring brings the group back and re-enables every group
                  memory share that was active at delete time.
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="space-y-2 pt-6">
                  {deletedGroups.map((g) => (
                    <div
                      key={g.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-dashed border-muted-foreground/30 p-3 text-sm"
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate font-medium">{g.name}</span>
                        <span className="text-xs text-muted-foreground">
                          deleted {new Date(g.deletedAt).toLocaleString()}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="bg-foreground/10 hover:bg-foreground/20"
                        disabled={restoringId === g.id}
                        onClick={() => void handleRestore(g)}
                      >
                        {restoringId === g.id ? (
                          <Loader2 className="mr-1 size-3 animate-spin" />
                        ) : (
                          <RotateCcw className="mr-1 size-3" />
                        )}
                        Restore
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        ) : null}
      </Tabs>

      <GroupDetailSheet
        membership={activeGroup}
        onClose={() => setActiveGroup(null)}
        onChanged={refresh}
        onConfirm={setConfirm}
      />

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'delete-group'
                ? `Delete "${confirm.groupName}"?`
                : confirm?.kind === 'leave-group'
                  ? `Leave "${confirm.groupName}"?`
                  : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'delete-group'
                ? 'Members lose access and every memory share is revoked. Only an admin can restore the deletion.'
                : confirm?.kind === 'leave-group'
                  ? "You'll lose access to memory shared with this group. You can be re-invited later."
                  : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SentInviteRow({ invite, onChange }: { invite: GroupInvite; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const handleRevoke = async () => {
    setBusy(true);
    try {
      await groupsApi.revokeInvite(invite.id);
      onChange();
    } finally {
      setBusy(false);
    }
  };
  const inviteeLabel = invite.invitee.name ?? invite.invitee.email;
  return (
    <div className="flex items-center justify-between rounded-md border p-3 text-sm">
      <div className="flex flex-col gap-1">
        <span className="font-medium">
          Invite to <span className="text-foreground">{inviteeLabel}</span> for{' '}
          <span className="text-foreground">{invite.group.name}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {invite.invitee.email} · {invite.status} · sent{' '}
          {new Date(invite.createdAt).toLocaleString()}
        </span>
      </div>
      {invite.status === 'PENDING' ? (
        <Button size="sm" variant="ghost" onClick={handleRevoke} disabled={busy}>
          Revoke
        </Button>
      ) : null}
    </div>
  );
}

function GroupDetailSheet({
  membership,
  onClose,
  onChanged,
  onConfirm,
}: {
  membership: GroupMembership | null;
  onClose: () => void;
  onChanged: () => void;
  onConfirm: (
    c:
      | { kind: 'delete-group'; groupId: string; groupName: string }
      | { kind: 'leave-group'; groupId: string; groupName: string },
  ) => void;
}) {
  const [picked, setPicked] = useState<PickedUser[]>([]);
  const [inviting, setInviting] = useState(false);
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!membership) return;
    try {
      const d = await groupsApi.read(membership.groupId);
      setDetail(d);
    } catch {
      setDetail(null);
    }
  }, [membership]);

  useEffect(() => {
    if (membership) {
      void loadDetail();
      setPicked([]);
    } else {
      setDetail(null);
    }
  }, [membership, loadDetail]);

  if (!membership) return null;
  const isOwner = membership.role === 'OWNER';

  const handleInvite = async () => {
    if (picked.length === 0) return;
    setInviting(true);
    const targets = picked;
    const results = await Promise.allSettled(
      targets.map((u) => groupsApi.invite(membership.groupId, { inviteeId: u.id })),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failures = results
      .map((r, i) => ({ r, u: targets[i]! }))
      .filter(({ r }) => r.status === 'rejected') as {
      r: PromiseRejectedResult;
      u: PickedUser;
    }[];
    if (ok > 0) toast.success(`Sent ${ok} invite${ok === 1 ? '' : 's'}`);
    for (const { u, r } of failures) {
      const msg = r.reason instanceof Error ? r.reason.message : 'Invite failed';
      toast.error(`${u.email}: ${msg}`);
    }
    setPicked([]);
    await loadDetail();
    onChanged();
    setInviting(false);
  };

  const handleRemove = async (memberUserId: string) => {
    setRemovingId(memberUserId);
    try {
      await groupsApi.removeMember(membership.groupId, memberUserId);
      await loadDetail();
      onChanged();
    } catch {
      // surfaced via reload
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Sheet open={!!membership} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 pr-8">
            <span className="truncate">{membership.group.name}</span>
            <Badge variant={isOwner ? 'default' : 'secondary'}>{membership.role}</Badge>
          </SheetTitle>
          {membership.group.description ? (
            <SheetDescription>{membership.group.description}</SheetDescription>
          ) : null}
        </SheetHeader>

        <div className="space-y-6 px-4 py-6">
          <section className="space-y-3">
            <h3 className="text-sm font-medium">Invite members</h3>
            <InvitePicker
              groupId={membership.groupId}
              picked={picked}
              onChange={setPicked}
              disabled={inviting}
            />
            <Button
              onClick={handleInvite}
              disabled={picked.length === 0 || inviting}
              className="w-full"
            >
              {inviting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="mr-2 h-4 w-4" />
              )}
              {picked.length === 0
                ? 'Invite'
                : `Invite ${picked.length} ${picked.length === 1 ? 'person' : 'people'}`}
            </Button>
          </section>

          <section className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-medium">
              Members{detail ? ` (${detail.members.length})` : ''}
            </h3>
            {!detail ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading…
              </div>
            ) : detail.members.length === 0 ? (
              <p className="text-xs text-muted-foreground">No members yet.</p>
            ) : (
              <ul className="space-y-1">
                {detail.members.map((m) => (
                  <li
                    key={m.userId}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{m.user.name ?? m.user.email}</span>
                      <span className="truncate text-xs text-muted-foreground">{m.user.email}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={m.role === 'OWNER' ? 'default' : 'secondary'}>{m.role}</Badge>
                      {isOwner && m.role !== 'OWNER' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRemove(m.userId)}
                          disabled={removingId === m.userId}
                        >
                          {removingId === m.userId ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-medium">Danger zone</h3>
            <div className="flex flex-col gap-2">
              {/* Owners can't leave their own group; they delete it instead. */}
              {!isOwner ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    onConfirm({
                      kind: 'leave-group',
                      groupId: membership.groupId,
                      groupName: membership.group.name,
                    })
                  }
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Leave group
                </Button>
              ) : null}
              {isOwner ? (
                <Button
                  variant="destructive"
                  onClick={() =>
                    onConfirm({
                      kind: 'delete-group',
                      groupId: membership.groupId,
                      groupName: membership.group.name,
                    })
                  }
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete group
                </Button>
              ) : null}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
