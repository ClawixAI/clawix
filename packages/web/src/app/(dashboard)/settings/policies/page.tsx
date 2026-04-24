'use client';

import { PoliciesTab } from '../policies-tab';

export default function PoliciesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Policies</h1>
        <p className="text-sm text-muted-foreground">
          Manage governance policies, quotas, and limits.
        </p>
      </div>
      <PoliciesTab />
    </div>
  );
}
