'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { FolderOpen, Loader2 } from 'lucide-react';
import { authFetch } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { useAnimeOnMount } from '@/lib/anime/use-anime';
import { staggerFadeUp, STAGGER } from '@/lib/anime';
import { WorkspaceBreadcrumbs } from './breadcrumbs';
import { WorkspaceToolbar } from './workspace-toolbar';
import { FileList } from './file-list';
import { FilePreview } from './file-preview';
import { CreateDialog, DeleteDialog, MoveDialog, DiscardDialog, ConflictDialog } from './workspace-dialogs';
import { UploadZone } from './upload-zone';
import type { DirectoryListing, FileContent, FileEntry, UpdateContentResponse } from '@clawix/shared';

const FileEditor = dynamic(
  () => import('./file-editor').then((m) => ({ default: m.FileEditor })),
  { ssr: false },
);

export default function WorkspacePage() {
  const [currentPath, setCurrentPath] = useState('/');
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileContent | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [isLoadingDir, setIsLoadingDir] = useState(true);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState<'file' | 'directory' | null>(null);
  const [showUploadZone, setShowUploadZone] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const [moveTarget, setMoveTarget] = useState<FileEntry | null>(null);
  const [editing, setEditing] = useState(false);
  const [editingDirty, setEditingDirty] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [pendingContent, setPendingContent] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  useAnimeOnMount(staggerFadeUp('[data-animate="workspace-rows"] tr', { stagger: STAGGER.tight }));

  const fetchDirectory = useCallback(async (dirPath: string) => {
    setIsLoadingDir(true);
    setError(null);
    try {
      const data = await authFetch<DirectoryListing>(
        `/api/v1/workspace/files?path=${encodeURIComponent(dirPath)}`,
      );
      setListing(data);
      setCurrentPath(data.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
    } finally {
      setIsLoadingDir(false);
    }
  }, []);

  const fetchFileContent = useCallback(async (entry: FileEntry) => {
    setSelectedPath(entry.path);
    setIsLoadingFile(true);
    setError(null);
    try {
      const data = await authFetch<FileContent>(
        `/api/v1/workspace/files/content?path=${encodeURIComponent(entry.path)}`,
      );
      setSelectedFile(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file');
      setSelectedFile(null);
    } finally {
      setIsLoadingFile(false);
    }
  }, []);

  const handleNavigate = useCallback(
    (path: string) => {
      if (editing && editingDirty) {
        setPendingAction(() => () => {
          setEditing(false);
          setEditingDirty(false);
          setSelectedFile(null);
          setSelectedPath(null);
          fetchDirectory(path);
        });
        setShowDiscardDialog(true);
        return;
      }
      setEditing(false);
      setSelectedFile(null);
      setSelectedPath(null);
      fetchDirectory(path);
    },
    [fetchDirectory, editing, editingDirty],
  );

  const handleClosePreview = useCallback(() => {
    if (editing && editingDirty) {
      setPendingAction(() => () => {
        setEditing(false);
        setEditingDirty(false);
        setSelectedFile(null);
        setSelectedPath(null);
      });
      setShowDiscardDialog(true);
      return;
    }
    setEditing(false);
    setSelectedFile(null);
    setSelectedPath(null);
  }, [editing, editingDirty]);

  const handleCreateEntry = useCallback(async (name: string) => {
    if (!showCreateDialog) return;
    try {
      const entryPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
      await authFetch('/api/v1/workspace/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: entryPath, type: showCreateDialog }),
      });
      setShowCreateDialog(null);
      fetchDirectory(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create entry');
    }
  }, [showCreateDialog, currentPath, fetchDirectory]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await authFetch('/api/v1/workspace/files', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: deleteTarget.path }),
      });
      setDeleteTarget(null);
      if (selectedPath === deleteTarget.path) {
        setSelectedFile(null);
        setSelectedPath(null);
      }
      fetchDirectory(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  }, [deleteTarget, currentPath, fetchDirectory, selectedPath]);

  const handleRename = useCallback(async (entry: FileEntry, newName: string) => {
    try {
      await authFetch('/api/v1/workspace/files/rename', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: entry.path, newName }),
      });
      fetchDirectory(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename');
    }
  }, [currentPath, fetchDirectory]);

  const handleMove = useCallback(async (destination: string) => {
    if (!moveTarget) return;
    try {
      await authFetch('/api/v1/workspace/files/move', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: moveTarget.path, destination }),
      });
      setMoveTarget(null);
      fetchDirectory(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to move');
    }
  }, [moveTarget, currentPath, fetchDirectory]);

  const handleDownload = useCallback((entry: FileEntry) => {
    const url = `/api/v1/workspace/files/download?path=${encodeURIComponent(entry.path)}`;
    window.open(url, '_blank');
  }, []);

  const handleEdit = useCallback(() => {
    setEditing(true);
  }, []);

  const handleSave = useCallback(async (content: string) => {
    if (!selectedFile) return;
    try {
      const result = await authFetch<UpdateContentResponse>('/api/v1/workspace/files/content', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: selectedFile.path,
          content,
          expectedModifiedAt: selectedFile.modifiedAt,
        }),
      });
      setSelectedFile({ ...selectedFile, content, size: result.size, modifiedAt: result.modifiedAt });
      setEditing(false);
      setEditingDirty(false);
      fetchDirectory(currentPath);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setPendingContent(content);
        setShowConflictDialog(true);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to save file');
      }
    }
  }, [selectedFile, currentPath, fetchDirectory]);

  const handleCancelEdit = useCallback(() => {
    if (editingDirty) {
      setPendingAction(() => () => {
        setEditing(false);
        setEditingDirty(false);
      });
      setShowDiscardDialog(true);
    } else {
      setEditing(false);
    }
  }, [editingDirty]);

  const handleDiscard = useCallback(() => {
    setShowDiscardDialog(false);
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
  }, [pendingAction]);

  const handleOverwrite = useCallback(async () => {
    if (!selectedFile || pendingContent === null) return;
    setShowConflictDialog(false);
    try {
      const result = await authFetch<UpdateContentResponse>('/api/v1/workspace/files/content', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: selectedFile.path,
          content: pendingContent,
          expectedModifiedAt: selectedFile.modifiedAt,
          force: true,
        }),
      });
      setSelectedFile({ ...selectedFile, content: pendingContent, size: result.size, modifiedAt: result.modifiedAt });
      setEditing(false);
      setEditingDirty(false);
      setPendingContent(null);
      fetchDirectory(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save file');
    }
  }, [selectedFile, pendingContent, currentPath, fetchDirectory]);

  const handleReloadFile = useCallback(async () => {
    if (!selectedFile) return;
    setShowConflictDialog(false);
    setPendingContent(null);
    try {
      const data = await authFetch<FileContent>(
        `/api/v1/workspace/files/content?path=${encodeURIComponent(selectedFile.path)}`,
      );
      setSelectedFile(data);
      // Stay in edit mode with fresh content
      setEditingDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reload file');
    }
  }, [selectedFile]);

  const handleSelectFile = useCallback((entry: FileEntry) => {
    if (editing && editingDirty && selectedPath !== entry.path) {
      setPendingAction(() => () => {
        setEditing(false);
        setEditingDirty(false);
        fetchFileContent(entry);
      });
      setShowDiscardDialog(true);
      return;
    }
    setEditing(false);
    setEditingDirty(false);
    fetchFileContent(entry);
  }, [editing, editingDirty, selectedPath, fetchFileContent]);

  useEffect(() => {
    fetchDirectory('/');
  }, [fetchDirectory]);

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <FolderOpen className="size-6 text-amber-500" />
        <div>
          <h1 className="text-lg font-semibold">Workspace</h1>
          <p className="text-sm text-muted-foreground">Browse files in your workspace</p>
        </div>
      </div>

      {/* Breadcrumbs */}
      <WorkspaceBreadcrumbs currentPath={currentPath} onNavigate={handleNavigate} />

      {/* Toolbar */}
      <WorkspaceToolbar
        entryCount={listing?.entries.length ?? 0}
        onNewFile={() => setShowCreateDialog('file')}
        onNewFolder={() => setShowCreateDialog('directory')}
        onUpload={() => setShowUploadZone((prev) => !prev)}
      />

      {/* Upload Zone */}
      {showUploadZone && (
        <UploadZone
          currentPath={currentPath}
          onUploadComplete={() => fetchDirectory(currentPath)}
          onClose={() => setShowUploadZone(false)}
        />
      )}

      {/* Error */}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Content */}
      {isLoadingDir ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-4">
          {/* File list */}
          <div className={selectedFile || isLoadingFile ? 'w-3/5' : 'w-full'}>
            <FileList
              entries={listing?.entries ?? []}
              selectedPath={selectedPath}
              onNavigate={handleNavigate}
              onSelectFile={handleSelectFile}
              onDownload={handleDownload}
              onRename={handleRename}
              onMove={(entry) => setMoveTarget(entry)}
              onDelete={(entry) => setDeleteTarget(entry)}
              editingPath={editing ? selectedPath : null}
              editingDirty={editingDirty}
            />
          </div>

          {/* Preview panel */}
          {(selectedFile || isLoadingFile) && (
            <div className="w-2/5">
              {editing && selectedFile ? (
                <FileEditor
                  file={selectedFile}
                  onSave={handleSave}
                  onCancel={handleCancelEdit}
                  onDirtyChange={setEditingDirty}
                />
              ) : (
                <FilePreview
                  file={selectedFile}
                  isLoading={isLoadingFile}
                  onClose={handleClosePreview}
                  onEdit={handleEdit}
                />
              )}
            </div>
          )}
        </div>
      )}
      {showCreateDialog && (
        <CreateDialog
          type={showCreateDialog}
          open={!!showCreateDialog}
          onOpenChange={(open) => { if (!open) setShowCreateDialog(null); }}
          onConfirm={handleCreateEntry}
        />
      )}

      {deleteTarget && (
        <DeleteDialog
          name={deleteTarget.name}
          isDirectory={deleteTarget.isDirectory}
          open={!!deleteTarget}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          onConfirm={handleDelete}
        />
      )}

      {moveTarget && (
        <MoveDialog
          name={moveTarget.name}
          currentDir={currentPath}
          open={!!moveTarget}
          onOpenChange={(open) => { if (!open) setMoveTarget(null); }}
          onConfirm={handleMove}
        />
      )}

      <DiscardDialog
        filename={selectedFile?.name ?? ''}
        open={showDiscardDialog}
        onOpenChange={setShowDiscardDialog}
        onDiscard={handleDiscard}
      />

      <ConflictDialog
        filename={selectedFile?.name ?? ''}
        open={showConflictDialog}
        onOpenChange={setShowConflictDialog}
        onOverwrite={handleOverwrite}
        onReload={handleReloadFile}
      />
    </div>
  );
}
