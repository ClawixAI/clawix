'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export interface PaginationState {
  readonly page: number;
  readonly limit: number;
  readonly setPage: (page: number) => void;
  readonly setLimit: (limit: number) => void;
}

export interface PaginationOptions {
  /** Page-state query keys. Override when one page has multiple paginated lists. */
  readonly pageKey?: string;
  readonly limitKey?: string;
  readonly defaultLimit?: number;
}

/**
 * Read/write `page` and `limit` query params via Next App Router's
 * useSearchParams + router.replace. Refresh-safe, back-button-friendly,
 * URL-shareable. Resets to page 1 whenever the limit changes.
 */
export function usePaginationParams(options?: PaginationOptions): PaginationState {
  const pageKey = options?.pageKey ?? 'page';
  const limitKey = options?.limitKey ?? 'limit';
  const defaultLimit = options?.defaultLimit ?? 20;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const page = clampPositive(parseInt(searchParams.get(pageKey) ?? '', 10), 1);
  const limit = clampPositive(parseInt(searchParams.get(limitKey) ?? '', 10), defaultLimit);

  const update = useCallback(
    (next: { page?: number; limit?: number }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (typeof next.page === 'number') {
        if (next.page <= 1) params.delete(pageKey);
        else params.set(pageKey, String(next.page));
      }
      if (typeof next.limit === 'number') {
        if (next.limit === defaultLimit) params.delete(limitKey);
        else params.set(limitKey, String(next.limit));
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams, pageKey, limitKey, defaultLimit],
  );

  return useMemo(
    () => ({
      page,
      limit,
      setPage: (next: number) => {
        update({ page: next });
      },
      setLimit: (next: number) => {
        update({ page: 1, limit: next });
      },
    }),
    [page, limit, update],
  );
}

function clampPositive(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 1) return fallback;
  return value;
}
