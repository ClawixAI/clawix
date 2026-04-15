'use client';

import { FilePlus, FolderPlus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface WorkspaceToolbarProps {
  readonly entryCount: number;
  readonly onNewFile: () => void;
  readonly onNewFolder: () => void;
  readonly onUpload: () => void;
}

export function WorkspaceToolbar({
  entryCount,
  onNewFile,
  onNewFolder,
  onUpload,
}: WorkspaceToolbarProps) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={onNewFile}>
        <FilePlus className="mr-1.5 size-4" />
        New File
      </Button>
      <Button variant="outline" size="sm" onClick={onNewFolder}>
        <FolderPlus className="mr-1.5 size-4" />
        New Folder
      </Button>
      <Button variant="outline" size="sm" onClick={onUpload}>
        <Upload className="mr-1.5 size-4" />
        Upload
      </Button>
      <div className="flex-1" />
      <span className="text-xs text-muted-foreground">
        {entryCount} {entryCount === 1 ? 'item' : 'items'}
      </span>
    </div>
  );
}
