'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import anime from 'animejs';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/dashboard/app-sidebar';
import { NotificationBell } from '@/components/dashboard/notification-bell';
import { UnreadChatProvider } from '@/components/dashboard/unread-chat-provider';
import { Toaster } from '@/components/ui/sonner';
import { EASING, DURATION } from '@/lib/anime';

function AnimatedContent({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (!ref.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    ref.current.style.opacity = '0';
    ref.current.style.transform = 'translateY(12px)';

    anime({
      targets: ref.current,
      opacity: [0, 1],
      translateY: [12, 0],
      duration: DURATION.normal,
      easing: EASING,
    });
  }, [pathname]);

  return <div ref={ref}>{children}</div>;
}

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <UnreadChatProvider>
      <SidebarProvider>
        {/* Screen-reader / keyboard skip link — visible only when focused. */}
        <a
          href="#dashboard-main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md focus:ring-2 focus:ring-ring"
        >
          Skip to main content
        </a>
        <header className="fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger className="-ml-1" />
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
          </div>
        </header>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <main id="dashboard-main" tabIndex={-1} className="min-w-0 flex-1 overflow-auto pt-14">
            <AnimatedContent>{children}</AnimatedContent>
          </main>
        </SidebarInset>
        <Toaster richColors position="top-right" />
      </SidebarProvider>
    </UnreadChatProvider>
  );
}
