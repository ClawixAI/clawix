'use client';

import { X, FileWarning, Loader2, Pencil } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatFileSize } from '@/lib/format';
import type { FileContent } from '@clawix/shared';

interface FilePreviewProps {
  readonly file: FileContent | null;
  readonly isLoading: boolean;
  readonly onClose: () => void;
  readonly onEdit?: () => void;
}

export function FilePreview({ file, isLoading, onClose, onEdit }: FilePreviewProps) {
  if (isLoading) {
    return (
      <Card className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (!file) {
    return (
      <Card className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Select a file to preview</p>
      </Card>
    );
  }

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="flex flex-row items-center gap-2 space-y-0 border-b px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-medium">{file.name}</span>
          <Badge variant="secondary" className="shrink-0 text-xs">
            {file.type}
          </Badge>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatFileSize(file.size)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {onEdit &&
            ['text', 'code', 'markdown', 'json'].includes(file.type) &&
            file.content !== null && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={onEdit}
                title="Edit file"
              >
                <Pencil className="size-3.5" />
              </Button>
            )}
          <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto p-4">
        {file.content === null ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <FileWarning className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {file.truncated
                ? 'File is too large to preview (> 1 MB)'
                : 'Binary file — preview not available'}
            </p>
          </div>
        ) : file.type === 'markdown' ? (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <Markdown remarkPlugins={[remarkGfm]}>{file.content}</Markdown>
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/90">
            {file.content}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
