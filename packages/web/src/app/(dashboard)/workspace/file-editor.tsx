'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatFileSize } from '@/lib/format';
import type { FileContent } from '@clawix/shared';

interface FileEditorProps {
  readonly file: FileContent;
  readonly onSave: (content: string) => Promise<void>;
  readonly onCancel: () => void;
  readonly onDirtyChange?: (dirty: boolean) => void;
}

function getLanguageExtension(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
      return import('@codemirror/lang-javascript').then((m) =>
        m.javascript({
          typescript: ext === 'ts' || ext === 'tsx',
          jsx: ext === 'tsx' || ext === 'jsx',
        }),
      );
    case 'json':
    case 'jsonc':
    case 'json5':
      return import('@codemirror/lang-json').then((m) => m.json());
    case 'md':
    case 'mdx':
      return import('@codemirror/lang-markdown').then((m) => m.markdown());
    case 'css':
    case 'scss':
      return import('@codemirror/lang-css').then((m) => m.css());
    case 'html':
      return import('@codemirror/lang-html').then((m) => m.html());
    case 'py':
      return import('@codemirror/lang-python').then((m) => m.python());
    default:
      return Promise.resolve(null);
  }
}

export function FileEditor({ file, onSave, onCancel, onDirtyChange }: FileEditorProps) {
  const [content, setContent] = useState(file.content ?? '');
  const [extensions, setExtensions] = useState<import('@codemirror/state').Extension[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const isDirty = content !== (file.content ?? '');
  const prevDirtyRef = useRef(false);

  useEffect(() => {
    if (prevDirtyRef.current !== isDirty) {
      prevDirtyRef.current = isDirty;
      onDirtyChange?.(isDirty);
    }
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    getLanguageExtension(file.name).then((ext) => {
      setExtensions(ext ? [ext] : []);
    });
  }, [file.name]);

  useEffect(() => {
    setContent(file.content ?? '');
  }, [file.content, file.path]);

  const handleSave = useCallback(async () => {
    if (!isDirty || isSaving) return;
    setIsSaving(true);
    try {
      await onSave(content);
    } finally {
      setIsSaving(false);
    }
  }, [content, isDirty, isSaving, onSave]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="flex flex-row items-center gap-2 space-y-0 border-b px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-medium">{file.name}</span>
          {isDirty && <span className="text-amber-500 text-xs font-medium">● Modified</span>}
          <Badge variant="secondary" className="shrink-0 text-xs">
            {file.type}
          </Badge>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatFileSize(file.size)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="default"
            size="sm"
            className="h-7 gap-1 text-xs"
            disabled={!isDirty || isSaving}
            onClick={handleSave}
          >
            <Save className="size-3" />
            Save
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <CodeMirror
          value={content}
          onChange={setContent}
          extensions={extensions}
          theme="dark"
          className="h-full overflow-auto"
          basicSetup={{
            lineNumbers: true,
            bracketMatching: true,
            highlightActiveLine: true,
            foldGutter: true,
            autocompletion: false,
          }}
        />
      </CardContent>
      <div className="flex items-center justify-between border-t px-4 py-1.5 text-xs text-muted-foreground">
        <span>Ctrl+S to save</span>
        <span>{file.type}</span>
      </div>
    </Card>
  );
}
