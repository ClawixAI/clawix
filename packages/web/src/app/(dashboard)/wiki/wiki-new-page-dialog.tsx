'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: { title: string; summary: string; domain: string }) => Promise<void>;
}

export function WikiNewPageDialog({ open, onOpenChange, onSubmit }: Props) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [domain, setDomain] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setTitle('');
    setSummary('');
    setDomain('');
    setError('');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New wiki page</DialogTitle>
          <DialogDescription>
            Create a new page. Pick a domain so it groups correctly in the sidebar.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmedDomain = domain.trim().toLowerCase();
            if (!/^[a-z0-9][a-z0-9-]{0,49}$/.test(trimmedDomain)) {
              setError('Domain must be lowercase alphanumeric/hyphen, e.g. "hr" or "infra-ops"');
              return;
            }
            setSaving(true);
            setError('');
            void (async () => {
              try {
                await onSubmit({
                  title: title.trim(),
                  summary: summary.trim(),
                  domain: trimmedDomain,
                });
                reset();
                onOpenChange(false);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to create page');
              } finally {
                setSaving(false);
              }
            })();
          }}
          className="flex flex-col gap-3"
        >
          <div className="space-y-1">
            <Label htmlFor="wiki-new-title">Title</Label>
            <Input
              id="wiki-new-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wiki-new-summary">Summary</Label>
            <Input
              id="wiki-new-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              maxLength={200}
              required
              placeholder="One-line summary (≤200 chars)"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wiki-new-domain">Domain</Label>
            <Input
              id="wiki-new-domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              required
              placeholder="e.g. hr, infra, product"
            />
            <p className="text-xs text-muted-foreground">
              Written as the tag <code>domain:{domain || '<name>'}</code>.
            </p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Creating…' : 'Create page'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
