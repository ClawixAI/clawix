'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { authFetch } from '@/lib/auth';
import type { ApiGroup, ApiGroupMember } from './groups-tab';

interface ApiUser {
  id: string;
  name: string;
  email: string;
}

interface PaginatedUsers {
  data: ApiUser[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

// ------------------------------------------------------------------ //
//  Create Group Dialog                                                //
// ------------------------------------------------------------------ //

export function CreateGroupDialog({
  open,
  onOpenChange,
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  onSubmit: (form: FormData) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Group</DialogTitle>
          <DialogDescription>
            Add a new group for memory sharing and access control.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(new FormData(e.currentTarget));
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-group-name">Name</Label>
            <Input id="create-group-name" name="name" placeholder="Engineering Team" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-group-description">Description</Label>
            <textarea
              id="create-group-description"
              name="description"
              className="rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Optional description for this group"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ //
//  Edit Group Dialog                                                  //
// ------------------------------------------------------------------ //

export function EditGroupDialog({
  group,
  onOpenChange,
  saving,
  onSubmit,
}: {
  group: ApiGroup | null;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  onSubmit: (id: string, form: FormData) => void;
}) {
  if (!group) return null;

  return (
    <Dialog open={group !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Group</DialogTitle>
          <DialogDescription>Update settings for {group.name}.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(group.id, new FormData(e.currentTarget));
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-group-name">Name</Label>
            <Input id="edit-group-name" name="name" defaultValue={group.name} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-group-description">Description</Label>
            <textarea
              id="edit-group-description"
              name="description"
              className="rounded-md border bg-background px-3 py-2 text-sm"
              defaultValue={group.description ?? ''}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ //
//  Members Dialog                                                     //
// ------------------------------------------------------------------ //

export function MembersDialog({
  group,
  onOpenChange,
}: {
  group: ApiGroup | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [members, setMembers] = useState<ApiGroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState<'OWNER' | 'MEMBER'>('MEMBER');

  const fetchMembers = useCallback(async () => {
    if (!group) return;
    setLoading(true);
    setError('');
    try {
      const res = await authFetch<ApiGroupMember[]>(`/admin/groups/${group.id}/members`);
      setMembers(Array.isArray(res) ? res : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [group]);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await authFetch<PaginatedUsers>('/admin/users?limit=100');
      setUsers(Array.isArray(res.data) ? res.data : []);
    } catch {
      // Silently fail — user list is non-critical
    }
  }, []);

  useEffect(() => {
    if (group) {
      void fetchMembers();
      void fetchUsers();
    }
  }, [group, fetchMembers, fetchUsers]);

  if (!group) return null;

  const memberUserIds = new Set(members.map((m) => m.userId));
  const availableUsers = users.filter((u) => !memberUserIds.has(u.id));
  const ownerCount = members.filter((m) => m.role === 'OWNER').length;

  async function handleAddMember() {
    if (!addUserId || !group) return;
    setSaving(true);
    setError('');
    try {
      await authFetch(`/admin/groups/${group.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId: addUserId, role: addRole }),
      });
      setAddOpen(false);
      setAddUserId('');
      setAddRole('MEMBER');
      await fetchMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!group) return;
    setSaving(true);
    setError('');
    try {
      await authFetch(`/admin/groups/${group.id}/members/${userId}`, {
        method: 'DELETE',
      });
      await fetchMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      setSaving(false);
    }
  }

  async function handleRoleChange(userId: string, newRole: 'OWNER' | 'MEMBER') {
    if (!group) return;
    setSaving(true);
    setError('');
    try {
      await authFetch(`/admin/groups/${group.id}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: newRole }),
      });
      await fetchMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={group !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Members of {group.name}</DialogTitle>
          <DialogDescription>Manage who belongs to this group and their roles.</DialogDescription>
        </DialogHeader>
        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : members.length === 0 ? (
          <div className="rounded-md border bg-background/30 backdrop-blur-sm p-6 text-center text-sm text-muted-foreground">
            No members in this group yet.
          </div>
        ) : (
          <div className="rounded-md border bg-background/30 backdrop-blur-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.userId}>
                    <TableCell className="font-medium">{member.user.name}</TableCell>
                    <TableCell className="text-muted-foreground">{member.user.email}</TableCell>
                    <TableCell>
                      <select
                        className="rounded-md border bg-background px-2 py-1 text-sm"
                        value={member.role}
                        onChange={(e) => {
                          void handleRoleChange(
                            member.userId,
                            e.target.value as 'OWNER' | 'MEMBER',
                          );
                        }}
                        disabled={saving || (member.role === 'OWNER' && ownerCount <= 1)}
                      >
                        <option value="OWNER">Owner</option>
                        <option value="MEMBER">Member</option>
                      </select>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        onClick={() => {
                          void handleRemoveMember(member.userId);
                        }}
                        disabled={saving || (member.role === 'OWNER' && ownerCount <= 1)}
                        title={
                          member.role === 'OWNER' && ownerCount <= 1
                            ? 'Cannot remove the only owner'
                            : 'Remove member'
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Add Member Section */}
        {addOpen ? (
          <div className="flex items-end gap-3 rounded-md border p-4">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="add-member-user">User</Label>
              <select
                id="add-member-user"
                className="rounded-md border bg-background px-3 py-2 text-sm"
                value={addUserId}
                onChange={(e) => {
                  setAddUserId(e.target.value);
                }}
              >
                <option value="">Select a user...</option>
                {availableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="add-member-role">Role</Label>
              <select
                id="add-member-role"
                className="rounded-md border bg-background px-3 py-2 text-sm"
                value={addRole}
                onChange={(e) => {
                  setAddRole(e.target.value as 'OWNER' | 'MEMBER');
                }}
              >
                <option value="MEMBER">Member</option>
                <option value="OWNER">Owner</option>
              </select>
            </div>
            <Button
              size="sm"
              disabled={saving || !addUserId}
              onClick={() => {
                void handleAddMember();
              }}
            >
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Add
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setAddOpen(false);
                setAddUserId('');
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => {
              setAddOpen(true);
            }}
          >
            <Plus className="mr-1 size-4" />
            Add Member
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
