'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { authFetch } from '@/lib/auth';
import { formString } from '@/lib/form';
import { FieldError } from '@/components/ui/field-error';
import { type FieldErrors } from '@/lib/validation';
import { ModelCombobox } from './model-combobox';

/**
 * Shared agent-form building blocks used by both the admin agents page
 * (`user-agents/page.tsx`) and the agent dialogs (`agents-dialogs.tsx`).
 * Previously each file carried its own copy of `useProviders`,
 * `ProviderModelFields`, and `agentFormInput` (#111).
 */

export interface ProviderInfo {
  name: string;
  displayName: string;
  defaultModel: string;
  models: string[];
}

/** Fetch the configured providers once on mount. */
export function useProviders() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  useEffect(() => {
    void authFetch<{ data: ProviderInfo[] }>('/api/v1/agents/providers')
      .then((res) => {
        setProviders(Array.isArray(res.data) ? res.data : []);
      })
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : 'Failed to load providers');
      });
  }, []);

  return providers;
}

/** Build the agent validation input object from a form's FormData. */
export function agentFormInput(fd: FormData) {
  return {
    name: formString(fd, 'name'),
    description: formString(fd, 'description'),
    systemPrompt: formString(fd, 'systemPrompt'),
    provider: formString(fd, 'provider'),
    model: formString(fd, 'model'),
    apiBaseUrl: formString(fd, 'apiBaseUrl'),
    maxTokensPerRun: formString(fd, 'maxTokensPerRun'),
  };
}

/** Linked Provider select + Model combobox, with inline validation errors. */
export function ProviderModelFields({
  providers,
  defaultProvider,
  defaultModel,
  idPrefix,
  errors,
}: {
  providers: ProviderInfo[];
  defaultProvider?: string;
  defaultModel?: string;
  idPrefix: string;
  errors?: FieldErrors;
}) {
  const [selectedProvider, setSelectedProvider] = useState(
    defaultProvider ?? providers[0]?.name ?? '',
  );
  const currentProvider = providers.find((p) => p.name === selectedProvider);
  const models = currentProvider?.models ?? [];

  useEffect(() => {
    if (!selectedProvider && providers.length > 0) {
      setSelectedProvider(defaultProvider ?? providers[0]?.name ?? '');
    }
  }, [providers, defaultProvider, selectedProvider]);

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-provider`}>Provider</Label>
        <Select value={selectedProvider} onValueChange={setSelectedProvider} name="provider">
          <SelectTrigger id={`${idPrefix}-provider`} className="w-full">
            <SelectValue placeholder="Select a provider" />
          </SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p.name} value={p.name}>
                {p.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError message={errors?.['provider']} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-model`}>Model</Label>
        <ModelCombobox
          id={`${idPrefix}-model`}
          name="model"
          models={models}
          defaultValue={defaultModel ?? currentProvider?.defaultModel ?? ''}
          placeholder={currentProvider?.defaultModel || 'model-name'}
          required
        />
        <FieldError message={errors?.['model']} />
        <p className="text-xs text-muted-foreground">
          Type any model name. Predefined models appear as suggestions.
        </p>
      </div>
    </>
  );
}
