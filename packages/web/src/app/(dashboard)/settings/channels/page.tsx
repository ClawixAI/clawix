'use client';

import { ChannelsTab } from '../channels-tab';

export default function ChannelsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Channels</h1>
        <p className="text-sm text-muted-foreground">
          Configure messaging channels and integrations.
        </p>
      </div>
      <ChannelsTab />
    </div>
  );
}
