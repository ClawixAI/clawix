/**
 * Shared `prefers-reduced-motion` media-query check. Extracted from
 * `approval-card.tsx` (Task 13) so the tool-approval bell/banner (Task 14)
 * doesn't copy-paste the same guard — both gate their pulse/attention
 * animations on this.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
