'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, MonitorPlay } from 'lucide-react';
import { authFetch, getAccessToken } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ProjectorItem {
  name: string;
  path: string;
}

/** Message protocol for projector iframe → parent communication. */
interface ProjectorSaveMessage {
  type: 'projector:save';
  filename: string;
  content: string; // base64 for binary, plain text for text files
  encoding?: 'base64' | 'text';
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ProjectorPage() {
  const [items, setItems] = useState<ProjectorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [activeHtml, setActiveHtml] = useState<string | null>(null);
  const [loadingHtml, setLoadingHtml] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const fetchItems = useCallback(async () => {
    try {
      const res = await authFetch<{ success: boolean; data: ProjectorItem[] }>(
        '/api/v1/workspace/projector',
      );
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError('Failed to load projector items');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  // Listen for postMessage from iframe (save to workspace)
  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      if (event.data?.type !== 'projector:save') return;

      const msg = event.data as ProjectorSaveMessage;
      const outputPath = `/Output/Projector/${msg.filename}`;

      try {
        setSaveStatus(`Saving ${msg.filename}...`);

        const accessToken = await getAccessToken();
        if (!accessToken) throw new Error('Not authenticated');
        const apiBase = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

        // Convert content to blob
        let blob: Blob;
        if (msg.encoding === 'base64') {
          const byteChars = atob(msg.content);
          const byteArr = new Uint8Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) {
            byteArr[i] = byteChars.charCodeAt(i);
          }
          blob = new Blob([byteArr]);
        } else {
          blob = new Blob([msg.content], { type: 'text/plain' });
        }

        // Upload via workspace upload endpoint (FormData — no JSON content-type)
        const formData = new FormData();
        formData.append('file', blob, msg.filename);

        const res = await fetch(
          `${apiBase}/api/v1/workspace/files/upload?path=${encodeURIComponent(outputPath)}&overwrite=true`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
            body: formData,
          },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({ message: res.statusText }));
          throw new Error((body as { message?: string }).message ?? 'Upload failed');
        }

        setSaveStatus(`Saved to workspace: ${outputPath}`);
        setTimeout(() => {
          setSaveStatus('');
        }, 3000);

        // Notify iframe that save succeeded
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'projector:save-result', success: true, path: outputPath },
          '*',
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Save failed';
        setSaveStatus(`Error: ${message}`);
        setTimeout(() => {
          setSaveStatus('');
        }, 5000);

        iframeRef.current?.contentWindow?.postMessage(
          { type: 'projector:save-result', success: false, error: message },
          '*',
        );
      }
    };

    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
    };
  }, []);

  const openItem = useCallback(async (name: string) => {
    setLoadingHtml(true);
    setActiveItem(name);
    setActiveHtml(null);
    setSaveStatus('');
    try {
      const res = await authFetch<{
        success: boolean;
        data: { name: string; html: string };
      }>(`/api/v1/workspace/projector/${encodeURIComponent(name)}`);
      setActiveHtml(res.data.html);
    } catch {
      setError(`Failed to load "${name}"`);
      setActiveItem(null);
    } finally {
      setLoadingHtml(false);
    }
  }, []);

  const closeViewer = useCallback(() => {
    setActiveItem(null);
    setActiveHtml(null);
    setSaveStatus('');
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Projector</h1>
        <p className="text-sm text-muted-foreground">Micro-tools built by your agent</p>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <MonitorPlay className="mb-3 size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No tools yet. Ask your agent to build one for you!
          </p>
        </div>
      )}

      {/* Card grid */}
      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((item) => (
            <button
              key={item.name}
              className={cn(
                'flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground',
                activeItem === item.name && 'ring-2 ring-primary bg-accent text-accent-foreground',
              )}
              onClick={() => void openItem(item.name)}
            >
              <MonitorPlay className="size-4 shrink-0 text-muted-foreground" />
              {item.name}
            </button>
          ))}
        </div>
      )}

      {/* Projector modal */}
      <Dialog
        open={activeItem !== null}
        onOpenChange={(open) => {
          if (!open) closeViewer();
        }}
      >
        <DialogContent
          showCloseButton
          className="tv-effect flex h-[85vh] !w-[70vw] !max-w-none flex-col gap-0 p-0 overflow-hidden [&>[data-slot=dialog-close]]:z-50 [&>[data-slot=dialog-close]]:bg-background/80 [&>[data-slot=dialog-close]]:rounded-full [&>[data-slot=dialog-close]]:p-1"
        >
          <DialogTitle className="sr-only">{activeItem ?? 'Projector'}</DialogTitle>

          {/* Save status bar */}
          {saveStatus && (
            <div
              className={cn(
                'px-4 py-2 text-xs font-medium',
                saveStatus.startsWith('Error')
                  ? 'bg-destructive/20 text-destructive'
                  : saveStatus.startsWith('Saving')
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-green-500/20 text-green-400',
              )}
            >
              {saveStatus}
            </div>
          )}

          {loadingHtml ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : activeHtml ? (
            <iframe
              ref={iframeRef}
              srcDoc={activeHtml}
              sandbox="allow-scripts allow-forms allow-modals allow-downloads allow-popups allow-popups-to-escape-sandbox allow-same-origin"
              className="h-full w-full border-0"
              title={activeItem ?? 'Projector'}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
