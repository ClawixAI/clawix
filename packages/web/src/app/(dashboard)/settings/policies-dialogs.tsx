'use client';

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
import type { ApiPolicy } from './policies-tab';

// ------------------------------------------------------------------ //
//  Helpers                                                            //
// ------------------------------------------------------------------ //

const KNOWN_PROVIDERS = ['openai', 'anthropic', 'zai-coding'] as const;

function parseIntOrNull(value: string): number | null {
  if (value === '' || value === 'null') return null;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

function buildPolicyData(form: FormData): Record<string, unknown> {
  const data: Record<string, unknown> = {
    name: form.get('name'),
    description: (form.get('description') as string) || null,
    maxTokenBudget: parseIntOrNull(form.get('maxTokenBudget') as string),
    maxAgents: parseInt(form.get('maxAgents') as string, 10) || 5,
    maxSkills: parseInt(form.get('maxSkills') as string, 10) || 10,
    maxMemoryItems: parseInt(form.get('maxMemoryItems') as string, 10) || 1000,
    maxGroupsOwned: parseInt(form.get('maxGroupsOwned') as string, 10) || 5,
  };

  const providers: string[] = [];
  for (const p of KNOWN_PROVIDERS) {
    if (form.get(`provider_${p}`) === 'on') providers.push(p);
  }
  data['allowedProviders'] = providers;

  // Cron settings
  data['cronEnabled'] = form.get('cronEnabled') === 'on';
  data['maxScheduledTasks'] = parseInt(form.get('maxScheduledTasks') as string, 10) || 5;
  data['minCronIntervalSecs'] = parseInt(form.get('minCronIntervalSecs') as string, 10) || 300;
  data['maxTokensPerCronRun'] = parseIntOrNull(form.get('maxTokensPerCronRun') as string);

  return data;
}

// ------------------------------------------------------------------ //
//  Create Policy Dialog                                               //
// ------------------------------------------------------------------ //

export function CreatePolicyDialog({
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Policy</DialogTitle>
          <DialogDescription>Define a new governance policy with quotas and limits.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(buildPolicyData(new FormData(e.currentTarget)));
          }}
          className="flex flex-col gap-4"
        >
          <PolicyFormFields />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ //
//  Edit Policy Dialog                                                 //
// ------------------------------------------------------------------ //

export function EditPolicyDialog({
  policy,
  onOpenChange,
  saving,
  onSubmit,
}: {
  policy: ApiPolicy | null;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  onSubmit: (id: string, data: Record<string, unknown>) => void;
}) {
  if (!policy) return null;

  return (
    <Dialog open={policy !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Policy</DialogTitle>
          <DialogDescription>
            Update settings for {policy.name}.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(policy.id, buildPolicyData(new FormData(e.currentTarget)));
          }}
          className="flex flex-col gap-4"
        >
          <PolicyFormFields policy={policy} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
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

// ------------------------------------------------------------------ //
//  Shared Form Fields                                                 //
// ------------------------------------------------------------------ //

function PolicyFormFields({ policy }: { policy?: ApiPolicy }) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="policy-name">Name</Label>
        <Input
          id="policy-name"
          name="name"
          placeholder="e.g. Standard, Pro, Enterprise"
          defaultValue={policy?.name ?? ''}
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="policy-description">Description</Label>
        <Input
          id="policy-description"
          name="description"
          placeholder="Brief description of this policy tier"
          defaultValue={policy?.description ?? ''}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="policy-maxTokenBudget">Token Budget (cents/mo)</Label>
          <Input
            id="policy-maxTokenBudget"
            name="maxTokenBudget"
            type="number"
            min="0"
            placeholder="Empty = unlimited"
            defaultValue={policy?.maxTokenBudget ?? ''}
          />
          <p className="text-xs text-muted-foreground">In USD cents. Leave empty for unlimited.</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="policy-maxAgents">Max Agents</Label>
          <Input
            id="policy-maxAgents"
            name="maxAgents"
            type="number"
            min="1"
            defaultValue={policy?.maxAgents ?? 5}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="policy-maxSkills">Max Skills</Label>
          <Input
            id="policy-maxSkills"
            name="maxSkills"
            type="number"
            min="1"
            defaultValue={policy?.maxSkills ?? 10}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="policy-maxMemoryItems">Max Memory Items</Label>
          <Input
            id="policy-maxMemoryItems"
            name="maxMemoryItems"
            type="number"
            min="1"
            defaultValue={policy?.maxMemoryItems ?? 1000}
            required
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="policy-maxGroupsOwned">Max Groups Owned</Label>
        <Input
          id="policy-maxGroupsOwned"
          name="maxGroupsOwned"
          type="number"
          min="1"
          defaultValue={policy?.maxGroupsOwned ?? 5}
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Allowed Providers</Label>
        <div className="flex flex-wrap gap-4">
          {KNOWN_PROVIDERS.map((prov) => (
            <label key={prov} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name={`provider_${prov}`}
                className="size-4 rounded border"
                defaultChecked={policy?.allowedProviders.includes(prov) ?? false}
              />
              {prov}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Select which AI providers users on this policy can access.
        </p>
      </div>

      {/* Cron Scheduling */}
      <div className="flex flex-col gap-2">
        <Label>Scheduled Tasks (Cron)</Label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="cronEnabled"
            className="size-4 rounded border"
            defaultChecked={policy?.cronEnabled ?? false}
          />
          Enable cron scheduling
        </label>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="policy-maxScheduledTasks">Max Tasks</Label>
          <Input
            id="policy-maxScheduledTasks"
            name="maxScheduledTasks"
            type="number"
            min="1"
            defaultValue={policy?.maxScheduledTasks ?? 5}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="policy-minCronIntervalSecs">Min Interval (s)</Label>
          <Input
            id="policy-minCronIntervalSecs"
            name="minCronIntervalSecs"
            type="number"
            min="60"
            defaultValue={policy?.minCronIntervalSecs ?? 300}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="policy-maxTokensPerCronRun">Max Tokens/Run</Label>
          <Input
            id="policy-maxTokensPerCronRun"
            name="maxTokensPerCronRun"
            type="number"
            min="0"
            placeholder="Unlimited"
            defaultValue={policy?.maxTokensPerCronRun ?? ''}
          />
        </div>
      </div>
    </>
  );
}
