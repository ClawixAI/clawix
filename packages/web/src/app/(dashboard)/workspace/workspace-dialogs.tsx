'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, Folder } from 'lucide-react';
import { authFetch } from '@/lib/auth';
import { cn } from '@/lib/utils';
import type { DirectoryListing } from '@clawix/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// --- Validation ---

const INVALID_NAME_PATTERN = /[/\\]/;
const MAX_NAME_LENGTH = 255;

function validateName(name: string): string | null {
  if (name.length === 0) return 'Name is required';
  if (name.length > MAX_NAME_LENGTH) return 'Name must be 255 characters or fewer';
  if (INVALID_NAME_PATTERN.test(name)) return 'Name cannot contain slashes';
  return null;
}

// --- CreateDialog ---

interface CreateDialogProps {
  readonly type: 'file' | 'directory';
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: (name: string) => void;
  readonly isLoading?: boolean;
}

export function CreateDialog({
  type,
  open,
  onOpenChange,
  onConfirm,
  isLoading,
}: CreateDialogProps) {
  const [name, setName] = useState('');
  const error = name.length > 0 ? validateName(name) : null;
  const isFile = type === 'file';

  const handleConfirm = useCallback(() => {
    if (!validateName(name)) {
      onConfirm(name);
      setName('');
    }
  }, [name, onConfirm]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) setName('');
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New {isFile ? 'File' : 'Folder'}</DialogTitle>
          <DialogDescription>
            Enter a name for the new {isFile ? 'file' : 'folder'}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="entry-name">Name</Label>
          <Input
            id="entry-name"
            placeholder={isFile ? 'e.g. index.ts' : 'e.g. src'}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !error && name.length > 0) handleConfirm();
            }}
            autoFocus
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              handleOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!name || !!error || isLoading}>
            {isLoading ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- DeleteDialog ---

interface DeleteDialogProps {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly childCount?: number;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
  readonly isLoading?: boolean;
}

export function DeleteDialog({
  name,
  isDirectory,
  childCount,
  open,
  onOpenChange,
  onConfirm,
  isLoading,
}: DeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{name}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            {isDirectory
              ? childCount !== undefined
                ? `This folder contains ${childCount} ${childCount === 1 ? 'item' : 'items'}. This action cannot be undone.`
                : 'This folder and all its contents will be deleted. This action cannot be undone.'
              : 'This action cannot be undone.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isLoading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isLoading ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// --- MoveDialog ---

interface MoveDialogProps {
  readonly name: string;
  readonly currentDir: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: (destination: string) => void;
  readonly isLoading?: boolean;
}

interface DirNode {
  readonly path: string;
  readonly name: string;
  children: DirNode[] | null; // null = not loaded
  expanded: boolean;
}

function updateNode(
  nodes: DirNode[],
  targetPath: string,
  updater: (node: DirNode) => DirNode,
): DirNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return updater(node);
    }
    if (node.children !== null) {
      return { ...node, children: updateNode(node.children, targetPath, updater) };
    }
    return node;
  });
}

async function fetchDirs(path: string): Promise<DirNode[]> {
  const encoded = encodeURIComponent(path);
  const listing = await authFetch<DirectoryListing>(`/api/v1/workspace/files?path=${encoded}`);
  return listing.entries
    .filter((e) => e.type === 'directory')
    .map((e) => ({
      path: e.path,
      name: e.name,
      children: null,
      expanded: false,
    }));
}

export function MoveDialog({
  name,
  currentDir,
  open,
  onOpenChange,
  onConfirm,
  isLoading,
}: MoveDialogProps) {
  const [roots, setRoots] = useState<DirNode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Load root directories whenever dialog opens
  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setFetchError(null);
    setRoots([]);

    fetchDirs('/')
      .then((dirs) => {
        setRoots(dirs);
      })
      .catch(() => {
        setFetchError('Failed to load directories.');
      });
  }, [open]);

  const handleToggle = useCallback(async (node: DirNode) => {
    const nextExpanded = !node.expanded;

    if (nextExpanded && node.children === null) {
      // Lazy-load children first, then expand
      try {
        const children = await fetchDirs(node.path);
        setRoots((prev) =>
          updateNode(prev, node.path, (n) => ({ ...n, children, expanded: true })),
        );
      } catch {
        // silently leave unexpanded on error
      }
    } else {
      setRoots((prev) => updateNode(prev, node.path, (n) => ({ ...n, expanded: nextExpanded })));
    }
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setSelected(null);
        setFetchError(null);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  const handleConfirm = useCallback(() => {
    if (selected !== null) {
      onConfirm(selected);
    }
  }, [selected, onConfirm]);

  function renderNode(node: DirNode, depth: number): React.ReactNode {
    const isCurrentDir = node.path === currentDir;
    const isSelected = selected === node.path;
    const hasChildren = node.children === null || node.children.length > 0;

    return (
      <div key={node.path}>
        <div
          className={cn(
            'flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-sm transition-colors',
            isSelected && 'bg-accent text-accent-foreground',
            !isSelected && !isCurrentDir && 'hover:bg-muted',
            isCurrentDir && 'cursor-not-allowed opacity-50',
          )}
          style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
          onClick={() => {
            if (!isCurrentDir) setSelected(node.path);
          }}
        >
          <button
            type="button"
            aria-label={node.expanded ? 'Collapse' : 'Expand'}
            className={cn(
              'flex h-4 w-4 shrink-0 items-center justify-center rounded transition-transform',
              !hasChildren && 'invisible',
            )}
            onClick={(e) => {
              e.stopPropagation();
              void handleToggle(node);
            }}
          >
            <ChevronRight
              className={cn('h-3 w-3 transition-transform', node.expanded && 'rotate-90')}
            />
          </button>
          <Folder className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="truncate">{node.name}</span>
          {isCurrentDir && <span className="ml-auto text-xs text-muted-foreground">(current)</span>}
        </div>
        {node.expanded && node.children !== null && (
          <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  }

  const rootIsCurrentDir = currentDir === '/';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move &ldquo;{name}&rdquo;</DialogTitle>
          <DialogDescription>Select a destination folder.</DialogDescription>
        </DialogHeader>

        <div className="max-h-72 overflow-y-auto rounded border border-border bg-background p-1">
          {/* Workspace root entry */}
          <div
            className={cn(
              'flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-sm transition-colors',
              selected === '/' && 'bg-accent text-accent-foreground',
              selected !== '/' && !rootIsCurrentDir && 'hover:bg-muted',
              rootIsCurrentDir && 'cursor-not-allowed opacity-50',
            )}
            onClick={() => {
              if (!rootIsCurrentDir) setSelected('/');
            }}
          >
            <span className="h-4 w-4 shrink-0" />
            <Folder className="h-4 w-4 shrink-0 text-amber-500" />
            <span className="truncate font-medium">Workspace (root)</span>
            {rootIsCurrentDir && (
              <span className="ml-auto text-xs text-muted-foreground">(current)</span>
            )}
          </div>

          {fetchError && <p className="px-2 py-2 text-xs text-destructive">{fetchError}</p>}

          {roots.map((node) => renderNode(node, 0))}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              handleOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={selected === null || isLoading}>
            {isLoading ? 'Moving...' : 'Move'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- DiscardDialog ---------- */

interface DiscardDialogProps {
  readonly filename: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onDiscard: () => void;
}

export function DiscardDialog({ filename, open, onOpenChange, onDiscard }: DiscardDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
          <AlertDialogDescription>
            You have unsaved changes to <strong>{filename}</strong>. Discard them?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onDiscard}
          >
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ---------- ConflictDialog ---------- */

interface ConflictDialogProps {
  readonly filename: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOverwrite: () => void;
  readonly onReload: () => void;
}

export function ConflictDialog({
  filename,
  open,
  onOpenChange,
  onOverwrite,
  onReload,
}: ConflictDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-500" />
            File Changed
          </AlertDialogTitle>
          <AlertDialogDescription>
            <strong>{filename}</strong> was modified since you started editing. This may have been
            caused by an agent or another process.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="outline" onClick={onReload}>
            Reload File
          </Button>
          <AlertDialogAction
            className="bg-amber-600 text-white hover:bg-amber-700"
            onClick={onOverwrite}
          >
            Overwrite
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
