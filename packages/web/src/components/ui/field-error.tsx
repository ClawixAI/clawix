import { cn } from '@/lib/utils';

/**
 * Inline, field-level validation error message (#106). Renders nothing when
 * `message` is empty so it can be dropped under any input unconditionally.
 */
export function FieldError({ message, className }: { message?: string; className?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className={cn('text-xs text-destructive', className)}>
      {message}
    </p>
  );
}
