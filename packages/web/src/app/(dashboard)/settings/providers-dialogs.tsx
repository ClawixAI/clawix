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
import { formString } from '@/lib/form';
import { FieldError } from '@/components/ui/field-error';
import {
  parseForm,
  providerCreateSchema,
  providerEditSchema,
  type FieldErrors,
} from '@/lib/validation';
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
  const [errors, setErrors] = useState<FieldErrors>({});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Provider</DialogTitle>
          <DialogDescription>Configure a new AI provider with API credentials.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const parsed = parseForm(providerCreateSchema, {
              provider: formString(form, 'provider'),
              displayName: formString(form, 'displayName'),
              apiKey: formString(form, 'apiKey'),
              apiBaseUrl: formString(form, 'apiBaseUrl'),
            });
            if (!parsed.success) {
              setErrors(parsed.fieldErrors);
              return;
            }
            setErrors({});
            const data: Record<string, unknown> = {
              provider: parsed.data.provider,
              displayName: parsed.data.displayName,
              apiKey: parsed.data.apiKey,
              isDefault: form.get('isDefault') === 'on',
            };
            if (parsed.data.apiBaseUrl) data['apiBaseUrl'] = parsed.data.apiBaseUrl;
            onSubmit(data);
          }}
          className="flex flex-col gap-4"
          autoComplete="off"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-provider">Provider ID</Label>
            <Input
              id="create-provider"
              name="provider"
              placeholder="e.g. openai, anthropic, custom-llm"
              pattern="[a-z0-9-]+"
              maxLength={50}
              aria-invalid={errors['provider'] ? true : undefined}
              required
              autoComplete="off"
            />
            <FieldError message={errors['provider']} />
            <p className="text-xs text-muted-foreground">
              Unique identifier for this provider (lowercase, no spaces).
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-displayName">Display Name</Label>
            <Input
              id="create-displayName"
              name="displayName"
              placeholder="e.g. OpenAI, Anthropic, Custom LLM"
              maxLength={100}
              aria-invalid={errors['displayName'] ? true : undefined}
              required
              autoComplete="off"
            />
            <FieldError message={errors['displayName']} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-apiKey">API Key</Label>
            <PasswordInput
              id="create-apiKey"
              name="apiKey"
              placeholder="sk-..."
              aria-invalid={errors['apiKey'] ? true : undefined}
              required
              autoComplete="new-password"
            />
            <FieldError message={errors['apiKey']} />
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
              aria-invalid={errors['apiBaseUrl'] ? true : undefined}
              autoComplete="off"
            />
            <FieldError message={errors['apiBaseUrl']} />
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
  const [errors, setErrors] = useState<FieldErrors>({});

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
            const parsed = parseForm(providerEditSchema, {
              displayName: formString(form, 'displayName'),
              apiKey: formString(form, 'apiKey'),
              apiBaseUrl: formString(form, 'apiBaseUrl'),
            });
            if (!parsed.success) {
              setErrors(parsed.fieldErrors);
              return;
            }
            setErrors({});
            const data: Record<string, unknown> = { displayName: parsed.data.displayName };
            if (parsed.data.apiKey) data['apiKey'] = parsed.data.apiKey;
            data['apiBaseUrl'] = parsed.data.apiBaseUrl || null;
            onSubmit(provider.provider, data);
          }}
          className="flex flex-col gap-4"
          autoComplete="off"
          noValidate
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
              maxLength={100}
              aria-invalid={errors['displayName'] ? true : undefined}
              required
              autoComplete="off"
            />
            <FieldError message={errors['displayName']} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-apiKey">API Key</Label>
            <PasswordInput
              id="edit-apiKey"
              name="apiKey"
              placeholder="Leave blank to keep current key"
              autoComplete="new-password"
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
              aria-invalid={errors['apiBaseUrl'] ? true : undefined}
              autoComplete="off"
            />
            <FieldError message={errors['apiBaseUrl']} />
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
