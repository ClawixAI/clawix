'use client';

import * as React from 'react';

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface PaginationMeta {
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
}

export interface DataPaginationProps {
  readonly meta: PaginationMeta;
  readonly onPageChange: (page: number) => void;
  readonly onLimitChange?: (limit: number) => void;
  readonly pageSizeOptions?: readonly number[];
  readonly className?: string;
  readonly label?: string;
}

const DEFAULT_PAGE_SIZES = [10, 20, 50, 100] as const;

/**
 * Compact pagination control with numbered pages, prev/next, page-size
 * selector, and a "Showing X–Y of Z" range indicator.
 *
 * Rendered numbered slots use shadcn's <a> primitive — onClick preventDefault
 * keeps the URL clean while the parent owns the actual page-state mutation.
 */
export function DataPagination({
  meta,
  onPageChange,
  onLimitChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  className,
  label = 'items',
}: DataPaginationProps) {
  const { total, page, limit, totalPages } = meta;

  if (total === 0) return null;

  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);
  const safeTotalPages = Math.max(totalPages, 1);

  const pages = buildPageList(page, safeTotalPages);

  const handlePageClick = (target: number) => (event: React.MouseEvent) => {
    event.preventDefault();
    if (target < 1 || target > safeTotalPages || target === page) return;
    onPageChange(target);
  };

  const wrapperClass =
    'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between' +
    (className ? ` ${className}` : '');

  return (
    <div className={wrapperClass}>
      <p className="text-muted-foreground text-sm">
        Showing <span className="text-foreground font-medium">{start}</span>–
        <span className="text-foreground font-medium">{end}</span> of{' '}
        <span className="text-foreground font-medium">{total}</span> {label}
      </p>

      <Pagination className="mx-0 w-auto justify-end">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              aria-disabled={page <= 1}
              tabIndex={page <= 1 ? -1 : 0}
              className={page <= 1 ? 'pointer-events-none opacity-50' : ''}
              onClick={handlePageClick(page - 1)}
            />
          </PaginationItem>

          {pages.map((entry, idx) =>
            entry === 'ellipsis' ? (
              <PaginationItem key={`ellipsis-${idx}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={entry}>
                <PaginationLink href="#" isActive={entry === page} onClick={handlePageClick(entry)}>
                  {entry}
                </PaginationLink>
              </PaginationItem>
            ),
          )}

          <PaginationItem>
            <PaginationNext
              href="#"
              aria-disabled={page >= safeTotalPages}
              tabIndex={page >= safeTotalPages ? -1 : 0}
              className={page >= safeTotalPages ? 'pointer-events-none opacity-50' : ''}
              onClick={handlePageClick(page + 1)}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>

      {onLimitChange ? (
        <div className="flex items-center gap-2">
          <label
            htmlFor="data-pagination-limit"
            className="text-muted-foreground text-sm whitespace-nowrap"
          >
            Rows per page
          </label>
          <Select value={String(limit)} onValueChange={(value) => onLimitChange(Number(value))}>
            <SelectTrigger id="data-pagination-limit" className="h-9 w-[80px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  );
}

type PageEntry = number | 'ellipsis';

function buildPageList(current: number, total: number): readonly PageEntry[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const out: PageEntry[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  if (start > 2) out.push('ellipsis');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push('ellipsis');

  out.push(total);
  return out;
}
