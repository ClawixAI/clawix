'use client';

import { useCallback, useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getAccessToken } from '@/lib/auth';
import { formatFileSize } from '@/lib/format';

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

interface UploadZoneProps {
  readonly currentPath: string;
  readonly onUploadComplete: () => void;
  readonly onClose: () => void;
}

interface UploadItem {
  readonly file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

export function UploadZone({ currentPath, onUploadComplete, onClose }: UploadZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateUpload = useCallback((index: number, patch: Partial<UploadItem>) => {
    setUploads((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }, []);

  const uploadFile = useCallback(
    async (file: File, index: number) => {
      if (file.size > MAX_FILE_SIZE) {
        updateUpload(index, {
          status: 'error',
          error: `File exceeds ${formatFileSize(MAX_FILE_SIZE)} limit`,
        });
        return;
      }

      updateUpload(index, { status: 'uploading', progress: 0 });

      const token = await getAccessToken();
      if (!token) {
        updateUpload(index, { status: 'error', error: 'Not authenticated' });
        return;
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('path', currentPath);

      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const pct = Math.round((event.loaded / event.total) * 100);
            updateUpload(index, { progress: pct });
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status === 200 || xhr.status === 201) {
            updateUpload(index, { status: 'done', progress: 100 });
            onUploadComplete();
          } else if (xhr.status === 409) {
            updateUpload(index, { status: 'error', error: 'File already exists' });
          } else {
            updateUpload(index, {
              status: 'error',
              error: `Upload failed (${xhr.status})`,
            });
          }
          resolve();
        });

        xhr.addEventListener('error', () => {
          updateUpload(index, { status: 'error', error: 'Network error' });
          resolve();
        });

        xhr.addEventListener('abort', () => {
          updateUpload(index, { status: 'error', error: 'Upload cancelled' });
          resolve();
        });

        xhr.open('POST', `${API_BASE}/api/v1/workspace/files/upload`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.send(formData);
      });
    },
    [currentPath, onUploadComplete, updateUpload],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      const startIndex = uploads.length;
      const newItems: UploadItem[] = fileArray.map((file) => ({
        file,
        progress: 0,
        status: 'pending',
      }));

      setUploads((prev) => [...prev, ...newItems]);

      fileArray.forEach((file, i) => {
        void uploadFile(file, startIndex + i);
      });
    },
    [uploads.length, uploadFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const handleBrowseClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
        // Reset so the same file can be selected again
        e.target.value = '';
      }
    },
    [addFiles],
  );

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-6 py-10 transition-colors',
          isDragOver
            ? 'border-amber-500 bg-amber-500/10 text-amber-500'
            : 'border-border text-muted-foreground hover:border-muted-foreground/50',
        )}
      >
        <Upload className="h-8 w-8" />
        <p className="text-sm">
          Drop files here or{' '}
          <button
            type="button"
            onClick={handleBrowseClick}
            className="font-medium text-amber-500 underline-offset-4 hover:underline focus:outline-none"
          >
            browse
          </button>
        </p>
        <p className="text-xs text-muted-foreground">
          Max file size: {formatFileSize(MAX_FILE_SIZE)}
        </p>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
        aria-hidden="true"
      />

      {/* Upload list */}
      {uploads.length > 0 && (
        <ul className="flex flex-col gap-2">
          {uploads.map((item, index) => (
            <li key={index} className="flex flex-col gap-1 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{item.file.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatFileSize(item.file.size)}
                </span>
              </div>

              {(item.status === 'uploading' || item.status === 'pending') && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-amber-500 transition-all duration-200"
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
              )}

              {item.status === 'done' && (
                <span className="text-xs font-medium text-green-500">Done</span>
              )}

              {item.status === 'error' && (
                <span className="text-xs font-medium text-destructive">
                  {item.error ?? 'Upload failed'}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Close button */}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="mr-1 h-4 w-4" />
          Close
        </Button>
      </div>
    </div>
  );
}
