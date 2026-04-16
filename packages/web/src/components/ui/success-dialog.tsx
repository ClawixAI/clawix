'use client';

import { useEffect, useRef } from 'react';
import anime from 'animejs';
import { EASING } from '@/lib/anime';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';

function AnimatedCheckmark() {
  const pathRef = useRef<SVGPathElement>(null);
  const circleRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    if (circleRef.current) {
      const len = circleRef.current.getTotalLength();
      circleRef.current.style.strokeDasharray = String(len);
      circleRef.current.style.strokeDashoffset = String(len);
      anime({
        targets: circleRef.current,
        strokeDashoffset: [len, 0],
        duration: 400,
        easing: EASING,
      });
    }

    if (pathRef.current) {
      const len = pathRef.current.getTotalLength();
      pathRef.current.style.strokeDasharray = String(len);
      pathRef.current.style.strokeDashoffset = String(len);
      anime({
        targets: pathRef.current,
        strokeDashoffset: [len, 0],
        duration: 300,
        delay: 300,
        easing: EASING,
      });
    }
  }, []);

  return (
    <svg viewBox="0 0 52 52" className="size-8">
      <circle
        ref={circleRef}
        cx="26"
        cy="26"
        r="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-green-500"
      />
      <path
        ref={pathRef}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14 27l7 7 16-16"
        className="text-green-500"
      />
    </svg>
  );
}

interface SuccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Optional action button (e.g., "Next", "Assign Agent") */
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Label for the dismiss button. Defaults to "Done" */
  dismissLabel?: string;
}

export function SuccessDialog({
  open,
  onOpenChange,
  title,
  description,
  action,
  dismissLabel = 'Done',
}: SuccessDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <div className="flex flex-col items-center gap-4 py-6">
          <div className="flex size-16 items-center justify-center rounded-full bg-green-500/15">
            <AnimatedCheckmark />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold">{title}</h3>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {dismissLabel}
            </Button>
            {action && <Button onClick={action.onClick}>{action.label}</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
