'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
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
import { formString } from '@/lib/form';
import { FieldError } from '@/components/ui/field-error';
import {
  parseForm,
  policyFormSchema,
  type FieldErrors,
  type PolicyFormValues,
} from '@/lib/validation';
import type { ApiPolicy } from './policies-tab';

// ------------------------------------------------------------------ //
//  Types                                                              //
// ------------------------------------------------------------------ //

interface ProviderOption {
  provider: string;
  displayName: string;
}

// ------------------------------------------------------------------ //
//  Helpers                                                            //
// ------------------------------------------------------------------ //

/** Raw string values pulled from the policy form, for zod validation. */
function policyFormInput(form: FormData) {
  return {
    name: formString(form, 'name'),
    description: formString(form, 'description'),
    maxTokenBudget: formString(form, 'maxTokenBudget'),
    maxAgents: formString(form, 'maxAgents'),
    maxSkills: formString(form, 'maxSkills'),
    maxGroupsOwned: formString(form, 'maxGroupsOwned'),
    maxScheduledTasks: formString(form, 'maxScheduledTasks'),
    minCronIntervalSecs: formString(form, 'minCronIntervalSecs'),
    maxTokensPerCronRun: formString(form, 'maxTokensPerCronRun'),
  };
}

const emptyToNull = (v: number | '' | undefined): number | null =>
  v === '' || v === undefined ? null : v;

/**
 * Convert a USD dollar amount from the form into integer cents for the API
 * (`maxTokenBudget` is stored in cents). Empty → null (unlimited).
 */
const dollarsToCents = (v: number | '' | undefined): number | null =>
  v === '' || v === undefined ? null : Math.round(v * 100);

/** Build the API payload from validated values + the checkbox/provider fields. */
function policyPayload(
  parsed: PolicyFormValues,
  form: FormData,
  availableProviders: ProviderOption[],
): Record<string, unknown> {
  const providers: string[] = [];
  for (const p of availableProviders) {
    if (form.get(`provider_${p.provider}`) === 'on') providers.push(p.provider);
  }

  return {
    name: parsed.name,
    description: parsed.description && parsed.description.length > 0 ? parsed.description : null,
    maxTokenBudget: dollarsToCents(parsed.maxTokenBudget),
    maxAgents: parsed.maxAgents,
    maxSkills: parsed.maxSkills,
    maxGroupsOwned: parsed.maxGroupsOwned,
    allowedProviders: providers,
    cronEnabled: form.get('cronEnabled') === 'on',
    maxScheduledTasks: parsed.maxScheduledTasks,
    minCronIntervalSecs: parsed.minCronIntervalSecs,
    maxTokensPerCronRun: emptyToNull(parsed.maxTokensPerCronRun),
    allowMcp: form.get('allowMcp') === 'on',
  };
}

function useProviders() {
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    try {
      const res =
        await authFetch<{ provider: string; displayName: string; isEnabled: boolean }[]>(
          '/admin/providers',
        );
      const enabled = (res ?? []).filter((p) => p.isEnabled);
      setProviders(enabled.map((p) => ({ provider: p.provider, displayName: p.displayName })));
    } catch (e) {
      setProviders([]);
      toast.error(e instanceof Error ? e.message : 'Failed to load providers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProviders();
  }, [fetchProviders]);

  return { providers, loading };
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
  const { providers, loading: providersLoading } = useProviders();
  const [errors, setErrors] = useState<FieldErrors>({});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Policy</DialogTitle>
          <DialogDescription>
            Define a new governance policy with quotas and limits.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const parsed = parseForm(policyFormSchema, policyFormInput(form));
            if (!parsed.success) {
              setErrors(parsed.fieldErrors);
              return;
            }
            setErrors({});
            onSubmit(policyPayload(parsed.data, form, providers));
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <PolicyFormFields
            providers={providers}
            providersLoading={providersLoading}
            errors={errors}
          />
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
            <Button type="submit" disabled={saving || providersLoading}>
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
  const { providers, loading: providersLoading } = useProviders();
  const [errors, setErrors] = useState<FieldErrors>({});

  if (!policy) return null;

  return (
    <Dialog open={policy !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Policy</DialogTitle>
          <DialogDescription>Update settings for {policy.name}.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const parsed = parseForm(policyFormSchema, policyFormInput(form));
            if (!parsed.success) {
              setErrors(parsed.fieldErrors);
              return;
            }
            setErrors({});
            onSubmit(policy.id, policyPayload(parsed.data, form, providers));
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <PolicyFormFields
            policy={policy}
            providers={providers}
            providersLoading={providersLoading}
            errors={errors}
          />
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
            <Button type="submit" disabled={saving || providersLoading}>
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

function PolicyFormFields({
  policy,
  providers,
  providersLoading,
  errors,
}: {
  policy?: ApiPolicy;
  providers: ProviderOption[];
  providersLoading: boolean;
  errors?: FieldErrors;
}) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="policy-name">Name</Label>
        <Input
          id="policy-name"
          name="name"
          placeholder="e.g. Standard, Pro, Enterprise"
          defaultValue={policy?.name ?? ''}
          maxLength={60}
          aria-invalid={errors?.['name'] ? true : undefined}
          required
        />
        <FieldError message={errors?.['name']} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="policy-description">Description</Label>
        <Input
          id="policy-description"
          name="description"
          placeholder="Brief description of this policy tier"
          defaultValue={policy?.description ?? ''}
          maxLength={200}
          aria-invalid={errors?.['description'] ? true : undefined}
        />
        <FieldError message={errors?.['description']} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="policy-maxTokenBudget">Token Budget (USD / mo)</Label>
          <Input
            id="policy-maxTokenBudget"
            name="maxTokenBudget"
            type="number"
            min="0"
            step="0.01"
            placeholder="Empty = unlimited"
            defaultValue={policy?.maxTokenBudget != null ? policy.maxTokenBudget / 100 : ''}
            aria-invalid={errors?.['maxTokenBudget'] ? true : undefined}
          />
          <FieldError message={errors?.['maxTokenBudget']} />
          <p className="text-xs text-muted-foreground">
            In USD dollars. Leave empty for unlimited.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="policy-maxAgents">Max Agents</Label>
          <Input
            id="policy-maxAgents"
            name="maxAgents"
            type="number"
            min="1"
            defaultValue={policy?.maxAgents ?? 5}
            aria-invalid={errors?.['maxAgents'] ? true : undefined}
            required
          />
          <FieldError message={errors?.['maxAgents']} />
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
            aria-invalid={errors?.['maxSkills'] ? true : undefined}
            required
          />
          <FieldError message={errors?.['maxSkills']} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="policy-maxGroupsOwned">Max Groups Owned</Label>
          <Input
            id="policy-maxGroupsOwned"
            name="maxGroupsOwned"
            type="number"
            min="1"
            defaultValue={policy?.maxGroupsOwned ?? 5}
            aria-invalid={errors?.['maxGroupsOwned'] ? true : undefined}
            required
          />
          <FieldError message={errors?.['maxGroupsOwned']} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Allowed Providers</Label>
        {providersLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading providers...
          </div>
        ) : providers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No providers configured. Add providers in Settings &rarr; Providers first.
          </p>
        ) : (
          <div className="flex flex-wrap gap-4">
            {providers.map((prov) => (
              <label key={prov.provider} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name={`provider_${prov.provider}`}
                  className="size-4 rounded border"
                  defaultChecked={policy?.allowedProviders.includes(prov.provider) ?? false}
                />
                {prov.displayName}
              </label>
            ))}
          </div>
        )}
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

      {/* MCP Servers */}
      <div className="flex flex-col gap-2">
        <Label>MCP Servers</Label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="allowMcp"
            className="size-4 rounded border"
            defaultChecked={policy?.allowMcp ?? false}
          />
          Allow MCP servers
        </label>
        <p className="text-xs text-muted-foreground">
          Users on this policy can connect imported MCP servers and bind their tools to agents.
        </p>
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
            aria-invalid={errors?.['maxScheduledTasks'] ? true : undefined}
          />
          <FieldError message={errors?.['maxScheduledTasks']} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="policy-minCronIntervalSecs">Min Interval (s)</Label>
          <Input
            id="policy-minCronIntervalSecs"
            name="minCronIntervalSecs"
            type="number"
            min="60"
            defaultValue={policy?.minCronIntervalSecs ?? 300}
            aria-invalid={errors?.['minCronIntervalSecs'] ? true : undefined}
          />
          <FieldError message={errors?.['minCronIntervalSecs']} />
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
            aria-invalid={errors?.['maxTokensPerCronRun'] ? true : undefined}
          />
          <FieldError message={errors?.['maxTokensPerCronRun']} />
        </div>
      </div>
    </>
  );
}
