'use client';

import { ProvidersTab } from '../providers-tab';

export default function ProvidersPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Providers</h1>
        <p className="text-sm text-muted-foreground">
          Manage AI provider API keys and configurations.
        </p>
      </div>
      <ProvidersTab />
    </div>
  );
}
