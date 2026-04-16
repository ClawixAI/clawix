'use client';

import { VantaBackground } from '@/components/ui/vanta-background';

export default function GovernanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <VantaBackground effect="topology" className="min-h-[calc(100vh-3.5rem)] p-6">
      {children}
    </VantaBackground>
  );
}
