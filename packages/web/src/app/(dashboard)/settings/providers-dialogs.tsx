'use client';

import { useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ApiProvider } from './providers-tab';

// ------------------------------------------------------------------ //
//  Password Input with visibility toggle                              //
// ------------------------------------------------------------------ //

function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? 'text' : 'password'} className="pr-10" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-0 top-0 size-9 text-muted-foreground hover:text-foreground"
        onClick={() => {
          setVisible((v) => !v);
        }}
        tabIndex={-1}
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ //
//  Provider options                                                   //
// ------------------------------------------------------------------ //

const PROVIDER_OPTIONS = [
  { id: 'openai', name: 'OpenAI' },
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'zai-coding', name: 'Z.AI Coding' },
] as const;

// ------------------------------------------------------------------ //
//  Create Provider Dialog                                             //
// ------------------------------------------------------------------ //

export function CreateProviderDialog({
  open,
  onOpenChange,
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  onSubmit: (data: Record<string, unknown>) => void;
}) {
  const [selectedProvider, setSelectedProvider] = useState('');

  const selectedOption = PROVIDER_OPTIONS.find((p) => p.id === selectedProvider);

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) setSelectedProvider('');
        onOpenChange(isOpen);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Provider</DialogTitle>
          <DialogDescription>Configure a new AI provider with API credentials.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const data: Record<string, unknown> = {
              provider: selectedProvider,
              displayName: selectedOption?.name ?? selectedProvider,
              apiKey: form.get('apiKey'),
              isDefault: form.get('isDefault') === 'on',
            };
            const baseUrl = form.get('apiBaseUrl') as string;
            if (baseUrl) data['apiBaseUrl'] = baseUrl;
            onSubmit(data);
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-provider">Provider</Label>
            <select
              id="create-provider"
              className="rounded-md border bg-background px-3 py-2 text-sm"
              value={selectedProvider}
              onChange={(e) => {
                setSelectedProvider(e.target.value);
              }}
              required
            >
              <option value="">Select a provider...</option>
              {PROVIDER_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-apiKey">API Key</Label>
            <PasswordInput id="create-apiKey" name="apiKey" placeholder="sk-..." required />
            <p className="text-xs text-muted-foreground">
              Encrypted at rest. Never displayed in full after saving.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-apiBaseUrl">Base URL (optional)</Label>
            <Input
              id="create-apiBaseUrl"
              name="apiBaseUrl"
              type="url"
              placeholder="https://api.example.com/v1"
            />
            <p className="text-xs text-muted-foreground">
              Only needed for custom or self-hosted endpoints.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="create-isDefault"
              name="isDefault"
              className="size-4 rounded border"
            />
            <Label htmlFor="create-isDefault">Set as default provider</Label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Add Provider
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ //
//  Edit Provider Dialog                                               //
// ------------------------------------------------------------------ //

export function EditProviderDialog({
  provider,
  onOpenChange,
  saving,
  onSubmit,
}: {
  provider: ApiProvider | null;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  onSubmit: (providerName: string, data: Record<string, unknown>) => void;
}) {
  if (!provider) return null;

  return (
    <Dialog open={provider !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Provider</DialogTitle>
          <DialogDescription>Update settings for {provider.displayName}.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const data: Record<string, unknown> = {};
            const displayName = form.get('displayName') as string;
            const apiKey = form.get('apiKey') as string;
            const baseUrl = form.get('apiBaseUrl') as string;
            if (displayName) data['displayName'] = displayName;
            if (apiKey) data['apiKey'] = apiKey;
            data['apiBaseUrl'] = baseUrl || null;
            onSubmit(provider.provider, data);
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label>Provider ID</Label>
            <Input value={provider.provider} disabled />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-displayName">Display Name</Label>
            <Input
              id="edit-displayName"
              name="displayName"
              defaultValue={provider.displayName}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-apiKey">API Key</Label>
            <PasswordInput
              id="edit-apiKey"
              name="apiKey"
              placeholder="Leave blank to keep current key"
            />
            <p className="text-xs text-muted-foreground">
              Current key: {provider.apiKey}. Leave blank to keep it.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-apiBaseUrl">Base URL (optional)</Label>
            <Input
              id="edit-apiBaseUrl"
              name="apiBaseUrl"
              type="url"
              defaultValue={provider.apiBaseUrl ?? ''}
              placeholder="https://api.example.com/v1"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
