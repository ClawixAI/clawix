'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  File,
  FileCode,
  FileJson,
  FileText,
  Folder,
  Image,
  Film,
  Music,
  FileArchive,
  FileType2,
  ArrowUpDown,
  Download,
  MoreVertical,
  Pencil,
  Move,
  Trash2,
} from 'lucide-react';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatFileSize } from '@/lib/format';
import type { FileEntry, FileType } from '@clawix/shared';

interface FileListProps {
  readonly entries: readonly FileEntry[];
  readonly selectedPath: string | null;
  readonly onNavigate: (path: string) => void;
  readonly onSelectFile: (entry: FileEntry) => void;
  readonly onDownload?: (entry: FileEntry) => void;
  readonly onRename?: (entry: FileEntry, newName: string) => void;
  readonly onMove?: (entry: FileEntry) => void;
  readonly onDelete?: (entry: FileEntry) => void;
  readonly editingPath?: string | null;
  readonly editingDirty?: boolean;
}

type SortField = 'name' | 'size' | 'modifiedAt';
type SortDirection = 'asc' | 'desc';

const FILE_ICONS: Record<FileType, typeof File> = {
  directory: Folder,
  code: FileCode,
  markdown: FileText,
  json: FileJson,
  text: FileText,
  image: Image,
  video: Film,
  audio: Music,
  pdf: FileType2,
  archive: FileArchive,
  unknown: File,
};

function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function FileList({
  entries,
  selectedPath,
  onNavigate,
  onSelectFile,
  onDownload,
  onRename,
  onMove,
  onDelete,
  editingPath,
  editingDirty,
}: FileListProps) {
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const toggleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return field;
    });
  }, []);

  const sorted = useMemo(() => [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;

    let cmp = 0;
    switch (sortField) {
      case 'name':
        cmp = a.name.localeCompare(b.name);
        break;
      case 'size':
        cmp = a.size - b.size;
        break;
      case 'modifiedAt':
        cmp = new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime();
        break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  }), [entries, sortField, sortDir]);

  const handleRowClick = useCallback(
    (entry: FileEntry) => {
      if (entry.isDirectory) {
        onNavigate(entry.path);
      } else {
        onSelectFile(entry);
      }
    },
    [onNavigate, onSelectFile],
  );

  const startRename = useCallback((entry: FileEntry) => {
    setRenamingPath(entry.path);
    setRenameValue(entry.name);
  }, []);

  const confirmRename = useCallback(
    (entry: FileEntry) => {
      if (renameValue && renameValue !== entry.name && onRename) {
        onRename(entry, renameValue);
      }
      setRenamingPath(null);
    },
    [renameValue, onRename],
  );

  const cancelRename = useCallback(() => {
    setRenamingPath(null);
  }, []);

  if (entries.length === 0) {
    return (
      <div className="rounded-md border bg-background/30 p-8 text-center backdrop-blur-sm">
        <Folder className="mx-auto mb-3 size-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">This workspace is empty</p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Files will appear here once an agent creates them
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-background/30 backdrop-blur-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead
              className="cursor-pointer select-none"
              onClick={() => toggleSort('name')}
            >
              <span className="flex items-center gap-1">
                Name <ArrowUpDown className="size-3 text-muted-foreground" />
              </span>
            </TableHead>
            <TableHead
              className="w-[100px] cursor-pointer select-none"
              onClick={() => toggleSort('size')}
            >
              <span className="flex items-center gap-1">
                Size <ArrowUpDown className="size-3 text-muted-foreground" />
              </span>
            </TableHead>
            <TableHead
              className="w-[140px] cursor-pointer select-none"
              onClick={() => toggleSort('modifiedAt')}
            >
              <span className="flex items-center gap-1">
                Modified <ArrowUpDown className="size-3 text-muted-foreground" />
              </span>
            </TableHead>
            <TableHead className="w-[40px]" />
          </TableRow>
        </TableHeader>
        <TableBody data-animate="workspace-rows">
          {sorted.map((entry) => {
            const Icon = FILE_ICONS[entry.type];
            const isSelected = entry.path === selectedPath;
            return (
              <TableRow
                key={entry.path}
                className={cn(
                  'cursor-pointer',
                  isSelected && 'bg-muted/50',
                )}
                onClick={() => handleRowClick(entry)}
              >
                <TableCell className="font-medium">
                  {renamingPath === entry.path ? (
                    <Input
                      className="h-7 text-sm"
                      value={renameValue}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') confirmRename(entry);
                        if (e.key === 'Escape') cancelRename();
                      }}
                      onBlur={() => confirmRename(entry)}
                      autoFocus
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <Icon className={cn('size-4 shrink-0', entry.isDirectory ? 'text-amber-500' : 'text-muted-foreground')} />
                      <span className="truncate">{entry.name}</span>
                      {editingDirty && editingPath === entry.path && (
                        <span className="text-amber-500 text-xs" title="Unsaved changes">●</span>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {entry.isDirectory ? '—' : formatFileSize(entry.size)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatRelativeDate(entry.modifiedAt)}
                </TableCell>
                <TableCell className="p-0">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="flex size-8 items-center justify-center rounded-md hover:bg-accent"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="size-4 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      {!entry.isDirectory && (
                        <DropdownMenuItem onSelect={() => onDownload?.(entry)}>
                          <Download className="mr-2 size-4" />
                          Download
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => startRename(entry)}>
                        <Pencil className="mr-2 size-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onMove?.(entry)}>
                        <Move className="mr-2 size-4" />
                        Move to...
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => onDelete?.(entry)}
                      >
                        <Trash2 className="mr-2 size-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
