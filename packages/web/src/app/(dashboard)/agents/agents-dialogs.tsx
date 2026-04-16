'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
import { authFetch } from '@/lib/auth';
import type { ApiAgent } from './agents-list';

// ------------------------------------------------------------------ //
//  Provider data                                                      //
// ------------------------------------------------------------------ //

interface ProviderInfo {
  name: string;
  displayName: string;
  defaultModel: string;
  models: string[];
}

function useProviders() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  useEffect(() => {
    void authFetch<{ data: ProviderInfo[] }>('/api/v1/agents/providers')
      .then((res) => {
        setProviders(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => {});
  }, []);

  return providers;
}

// ------------------------------------------------------------------ //
//  Provider + Model selects (linked)                                  //
// ------------------------------------------------------------------ //

function ProviderModelFields({
  providers,
  defaultProvider,
  defaultModel,
  idPrefix,
}: {
  providers: ProviderInfo[];
  defaultProvider?: string;
  defaultModel?: string;
  idPrefix: string;
}) {
  const [selectedProvider, setSelectedProvider] = useState(
    defaultProvider ?? providers[0]?.name ?? '',
  );
  const currentProvider = providers.find((p) => p.name === selectedProvider);
  const models = currentProvider?.models ?? [];

  // Set default provider when providers load
  useEffect(() => {
    if (!selectedProvider && providers.length > 0) {
      setSelectedProvider(defaultProvider ?? providers[0]!.name);
    }
  }, [providers, defaultProvider, selectedProvider]);

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-provider`}>Provider</Label>
        <select
          name="provider"
          id={`${idPrefix}-provider`}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={selectedProvider}
          onChange={(e) => {
            setSelectedProvider(e.target.value);
          }}
        >
          {providers.map((p) => (
            <option key={p.name} value={p.name}>
              {p.displayName}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-model`}>Model</Label>
        {models.length > 0 ? (
          <select
            name="model"
            id={`${idPrefix}-model`}
            className="rounded-md border bg-background px-3 py-2 text-sm"
            defaultValue={defaultModel ?? currentProvider?.defaultModel ?? ''}
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <Input
            id={`${idPrefix}-model`}
            name="model"
            placeholder={currentProvider?.defaultModel ?? 'model-name'}
            defaultValue={defaultModel ?? currentProvider?.defaultModel ?? ''}
            required
          />
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ //
//  Create Agent Dialog                                                //
// ------------------------------------------------------------------ //

export function CreateAgentDialog({
  open,
  onOpenChange,
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  onSubmit: (form: FormData) => void;
}) {
  const providers = useProviders();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Agent</DialogTitle>
          <DialogDescription>
            Define a new AI agent with its model, prompt, and skills.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(new FormData(e.currentTarget));
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-name">Name</Label>
            <Input id="create-name" name="name" placeholder="Research Assistant" required />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="create-description">Description</Label>
            <textarea
              id="create-description"
              name="description"
              rows={2}
              className="rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Optional description of this agent"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="create-systemPrompt">System Prompt</Label>
            <textarea
              id="create-systemPrompt"
              name="systemPrompt"
              rows={6}
              className="rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="You are a helpful AI assistant..."
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="create-role">Role</Label>
            <select
              name="role"
              id="create-role"
              className="rounded-md border bg-background px-3 py-2 text-sm"
              defaultValue="primary"
            >
              <option value="primary">Primary</option>
              <option value="worker">Worker (Sub-Agent)</option>
            </select>
          </div>

          <ProviderModelFields providers={providers} idPrefix="create" />

          <div className="flex flex-col gap-2">
            <Label htmlFor="create-apiBaseUrl">API Base URL</Label>
            <Input
              id="create-apiBaseUrl"
              name="apiBaseUrl"
              placeholder="https://api.example.com/v1"
            />
            <p className="text-xs text-muted-foreground">
              Optional. Override the default API endpoint for this provider.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="create-maxTokensPerRun">Max Tokens per Run</Label>
            <Input
              id="create-maxTokensPerRun"
              name="maxTokensPerRun"
              type="number"
              defaultValue={100000}
              min={1000}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="create-skillIds">Skill IDs</Label>
            <Input id="create-skillIds" name="skillIds" placeholder="Comma-separated skill IDs" />
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
              Create Agent
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ //
//  Edit Agent Dialog                                                  //
// ------------------------------------------------------------------ //

export function EditAgentDialog({
  agent,
  onOpenChange,
  saving,
  onSubmit,
}: {
  agent: ApiAgent | null;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  onSubmit: (id: string, form: FormData) => void;
}) {
  const providers = useProviders();

  if (!agent) return null;

  return (
    <Dialog open={agent !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Agent</DialogTitle>
          <DialogDescription>Update settings for {agent.name}.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(agent.id, new FormData(e.currentTarget));
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input id="edit-name" name="name" defaultValue={agent.name} required />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-description">Description</Label>
            <textarea
              id="edit-description"
              name="description"
              rows={2}
              className="rounded-md border bg-background px-3 py-2 text-sm"
              defaultValue={agent.description}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-systemPrompt">System Prompt</Label>
            <textarea
              id="edit-systemPrompt"
              name="systemPrompt"
              rows={6}
              className="rounded-md border bg-background px-3 py-2 text-sm"
              defaultValue={agent.systemPrompt}
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-role">Role</Label>
            <select
              name="role"
              id="edit-role"
              className="rounded-md border bg-background px-3 py-2 text-sm"
              defaultValue={agent.role}
            >
              <option value="primary">Primary</option>
              <option value="worker">Worker (Sub-Agent)</option>
            </select>
          </div>

          <ProviderModelFields
            providers={providers}
            defaultProvider={agent.provider}
            defaultModel={agent.model}
            idPrefix="edit"
          />

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-apiBaseUrl">API Base URL</Label>
            <Input
              id="edit-apiBaseUrl"
              name="apiBaseUrl"
              defaultValue={agent.apiBaseUrl ?? ''}
              placeholder="https://api.example.com/v1"
            />
            <p className="text-xs text-muted-foreground">
              Optional. Override the default API endpoint for this provider.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-maxTokensPerRun">Max Tokens per Run</Label>
            <Input
              id="edit-maxTokensPerRun"
              name="maxTokensPerRun"
              type="number"
              defaultValue={agent.maxTokensPerRun ?? 100000}
              min={1000}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-isActive">Status</Label>
            <select
              name="isActive"
              id="edit-isActive"
              className="rounded-md border bg-background px-3 py-2 text-sm"
              defaultValue={agent.isActive ? 'true' : 'false'}
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
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
