'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldError } from '@/components/ui/field-error';
import { agentFormSchema, parseForm, type FieldErrors } from '@/lib/validation';
import { ProviderModelFields, agentFormInput, useProviders } from './agent-form-fields';
import type { ApiAgent } from './agents-list';

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
  const [streamingEnabled, setStreamingEnabled] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

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
            const fd = new FormData(e.currentTarget);
            fd.set('streamingEnabled', String(streamingEnabled));
            const parsed = parseForm(agentFormSchema, agentFormInput(fd));
            if (!parsed.success) {
              setErrors(parsed.fieldErrors);
              return;
            }
            setErrors({});
            onSubmit(fd);
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-name">Name</Label>
            <Input
              id="create-name"
              name="name"
              placeholder="Research Assistant"
              maxLength={100}
              aria-invalid={errors['name'] ? true : undefined}
              required
            />
            <FieldError message={errors['name']} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="create-description">Description</Label>
            <textarea
              id="create-description"
              name="description"
              rows={2}
              maxLength={500}
              className="rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Optional description of this agent"
            />
            <FieldError message={errors['description']} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="create-systemPrompt">System Prompt</Label>
            <textarea
              id="create-systemPrompt"
              name="systemPrompt"
              rows={6}
              className="rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="You are a helpful AI assistant..."
              aria-invalid={errors['systemPrompt'] ? true : undefined}
              required
            />
            <FieldError message={errors['systemPrompt']} />
          </div>

          {/* Role is always worker for user-created agents; primary is system-only */}
          <input type="hidden" name="role" value="worker" />

          <ProviderModelFields providers={providers} idPrefix="create" errors={errors} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="create-apiBaseUrl">API Base URL</Label>
            <Input
              id="create-apiBaseUrl"
              name="apiBaseUrl"
              type="url"
              placeholder="https://api.example.com/v1"
              aria-invalid={errors['apiBaseUrl'] ? true : undefined}
            />
            <FieldError message={errors['apiBaseUrl']} />
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
              aria-invalid={errors['maxTokensPerRun'] ? true : undefined}
            />
            <FieldError message={errors['maxTokensPerRun']} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="create-skillIds">Skill IDs</Label>
            <Input id="create-skillIds" name="skillIds" placeholder="Comma-separated skill IDs" />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="create-streamingEnabled" className="text-base">
                Streaming
              </Label>
              <p className="text-sm text-muted-foreground">
                Send each reasoning step as a separate message. When off, the user receives one
                combined reply at the end of the run.
              </p>
            </div>
            <Switch
              id="create-streamingEnabled"
              checked={streamingEnabled}
              onCheckedChange={setStreamingEnabled}
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
  const [streamingEnabled, setStreamingEnabled] = useState(agent?.streamingEnabled ?? false);
  const [errors, setErrors] = useState<FieldErrors>({});

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
            const fd = new FormData(e.currentTarget);
            fd.set('streamingEnabled', String(streamingEnabled));
            const parsed = parseForm(agentFormSchema, agentFormInput(fd));
            if (!parsed.success) {
              setErrors(parsed.fieldErrors);
              return;
            }
            setErrors({});
            onSubmit(agent.id, fd);
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              name="name"
              defaultValue={agent.name}
              maxLength={100}
              aria-invalid={errors['name'] ? true : undefined}
              required
            />
            <FieldError message={errors['name']} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-description">Description</Label>
            <textarea
              id="edit-description"
              name="description"
              rows={2}
              maxLength={500}
              className="rounded-md border bg-background px-3 py-2 text-sm"
              defaultValue={agent.description}
            />
            <FieldError message={errors['description']} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-systemPrompt">System Prompt</Label>
            <textarea
              id="edit-systemPrompt"
              name="systemPrompt"
              rows={6}
              className="rounded-md border bg-background px-3 py-2 text-sm"
              defaultValue={agent.systemPrompt}
              aria-invalid={errors['systemPrompt'] ? true : undefined}
              required
            />
            <FieldError message={errors['systemPrompt']} />
          </div>

          {/* Role cannot be changed; primary is system-only, workers stay workers */}
          <div className="flex flex-col gap-2">
            <Label>Role</Label>
            <p className="text-sm text-muted-foreground">
              {agent.role === 'primary' ? 'Primary (system)' : 'Worker (Sub-Agent)'}
            </p>
            <input type="hidden" name="role" value={agent.role} />
          </div>

          <ProviderModelFields
            providers={providers}
            defaultProvider={agent.provider}
            defaultModel={agent.model}
            idPrefix="edit"
            errors={errors}
          />

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-apiBaseUrl">API Base URL</Label>
            <Input
              id="edit-apiBaseUrl"
              name="apiBaseUrl"
              type="url"
              defaultValue={agent.apiBaseUrl ?? ''}
              placeholder="https://api.example.com/v1"
              aria-invalid={errors['apiBaseUrl'] ? true : undefined}
            />
            <FieldError message={errors['apiBaseUrl']} />
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
              aria-invalid={errors['maxTokensPerRun'] ? true : undefined}
            />
            <FieldError message={errors['maxTokensPerRun']} />
          </div>

          {agent.role !== 'primary' && (
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
          )}

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="edit-streamingEnabled" className="text-base">
                Streaming
              </Label>
              <p className="text-sm text-muted-foreground">
                Send each reasoning step as a separate message. When off, the user receives one
                combined reply at the end of the run.
              </p>
            </div>
            <Switch
              id="edit-streamingEnabled"
              checked={streamingEnabled}
              onCheckedChange={setStreamingEnabled}
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
