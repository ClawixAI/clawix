import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/components/auth-provider';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Clawix',
  description: 'Enterprise-grade multi-agent AI orchestration platform',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={GeistSans.className}>
        {/* Skip link for pages that fall outside the dashboard layout (login,
            marketing). Dashboard pages have their own scoped skip link
            targeting #dashboard-main. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md focus:ring-2 focus:ring-ring"
        >
          Skip to main content
        </a>
        <ThemeProvider>
          <AuthProvider>
            <TooltipProvider>
              <div id="main-content">{children}</div>
            </TooltipProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
