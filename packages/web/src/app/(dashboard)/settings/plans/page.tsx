'use client';

import { PoliciesTab } from '../policies-tab';

export default function PlansPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Plans</h1>
        <p className="text-sm text-muted-foreground">
          Manage plans, quotas, and governance policies.
        </p>
      </div>
      <PoliciesTab />
    </div>
  );
}
