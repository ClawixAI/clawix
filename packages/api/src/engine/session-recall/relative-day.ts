const MS_PER_DAY = 86_400_000;

/**
 * Human relative-day label: "today" / "yesterday" / "N days ago", computed on
 * UTC calendar-day boundaries. Future dates collapse to "today".
 */
export function relativeDay(createdAt: Date, now: Date): string {
  const startOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.round((startOf(now) - startOf(createdAt)) / MS_PER_DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
