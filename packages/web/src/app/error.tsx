'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled error:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
      <div className="flex size-16 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10">
        <AlertTriangle className="size-8 text-destructive" />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Website currently not in service</h1>
        <p className="text-sm text-muted-foreground">
          Something went wrong. Please try again later.
        </p>
      </div>
      <div className="flex gap-3">
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
        <Button onClick={() => (window.location.href = '/conversations')}>Go to Home</Button>
      </div>
    </div>
  );
}
