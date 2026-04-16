'use client';

import { VantaBackground } from '@/components/ui/vanta-background';

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return (
    <VantaBackground effect="net" className="min-h-[calc(100vh-3.5rem)] p-6">
      {children}
    </VantaBackground>
  );
}
