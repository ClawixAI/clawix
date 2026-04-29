'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { authFetch } from '@/lib/auth';

const NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function CreateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) {
      setName('');
      setDescription('');
      setErr('');
    }
  }, [open]);

  const handleSubmit = async () => {
    setErr('');
    if (!NAME_REGEX.test(name)) {
      setErr('Name must be lowercase alphanumeric with hyphens.');
      return;
    }
    if (description.trim().length === 0) {
      setErr('Description is required.');
      return;
    }
    setSaving(true);
    try {
      await authFetch('/api/v1/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });
      setName('');
      setDescription('');
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create skill');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create skill</DialogTitle>
          <DialogDescription>
            Scaffolds a new skill under <code>/skills/&lt;name&gt;/SKILL.md</code> in your
            workspace.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input placeholder="skill-name" value={name} onChange={(e) => setName(e.target.value)} />
          <Textarea
            placeholder="What does this skill do, and when should the agent use it?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
          />
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditDialog({
  target,
  onClose,
  onSaved,
}: {
  target: { dirName: string; content: string } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setContent(target?.content ?? '');
    setErr('');
  }, [target]);

  if (!target) return null;

  const handleSave = async () => {
    setSaving(true);
    setErr('');
    try {
      await authFetch(`/api/v1/skills/${target.dirName}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="!w-[60vw] !max-w-none">
        <DialogHeader>
          <DialogTitle>Edit {target.dirName}/SKILL.md</DialogTitle>
          <DialogDescription>
            Frontmatter must remain valid (name, description). For more complex edits, use the
            workspace file editor.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="min-h-[60vh] font-mono text-sm"
        />
        {err && <p className="text-sm text-destructive">{err}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RenameDialog({
  target,
  onClose,
  onRenamed,
}: {
  target: { dirName: string } | null;
  onClose: () => void;
  onRenamed: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setNewName(target?.dirName ?? '');
    setErr('');
  }, [target]);

  if (!target) return null;

  const handleSubmit = async () => {
    setErr('');
    if (!NAME_REGEX.test(newName)) {
      setErr('Name must be lowercase alphanumeric with hyphens.');
      return;
    }
    setSaving(true);
    try {
      await authFetch(`/api/v1/skills/${target.dirName}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName }),
      });
      onRenamed();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to rename');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename skill</DialogTitle>
          <DialogDescription>
            The directory and the <code>name:</code> frontmatter field will both be updated.
          </DialogDescription>
        </DialogHeader>
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
        {err && <p className="text-sm text-destructive">{err}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteDialog({
  target,
  onClose,
  onDeleted,
}: {
  target: { dirName: string; name: string } | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  if (!target) return null;

  const handleConfirm = async () => {
    setSaving(true);
    setErr('');
    try {
      await authFetch(`/api/v1/skills/${target.dirName}`, { method: 'DELETE' });
      onDeleted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete skill</DialogTitle>
          <DialogDescription>
            Permanently deletes <strong>{target.name}</strong> and all its files. This cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void handleConfirm()} disabled={saving}>
            {saving ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
