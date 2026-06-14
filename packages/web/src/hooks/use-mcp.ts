'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getMcpCalls,
  listMcpServers,
  listMcpTools,
  type McpCallRow,
  type McpServerWithConnection,
  type McpToolDto,
} from '@/lib/mcp';
import { ApiError } from '@/lib/api';

interface FetchState<T> {
  data: T;
  loading: boolean;
  /** HTTP status of the failure (403 → plan-disabled empty state). */
  errorStatus: number | null;
  errorMessage: string;
  refetch: () => Promise<void>;
}

function useFetchList<T>(fetcher: () => Promise<T[]>): FetchState<T[]> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const refetch = useCallback(async () => {
    setLoading(true);
    setErrorStatus(null);
    setErrorMessage('');
    try {
      setData(await fetcher());
    } catch (err) {
      setErrorStatus(err instanceof ApiError ? err.status : 0);
      setErrorMessage(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, loading, errorStatus, errorMessage, refetch };
}

export function useMcpServers(): FetchState<McpServerWithConnection[]> {
  return useFetchList<McpServerWithConnection>(listMcpServers);
}

export function useMcpTools(serverId: string): FetchState<McpToolDto[]> {
  const fetcher = useCallback(() => listMcpTools(serverId), [serverId]);
  return useFetchList<McpToolDto>(fetcher);
}

/** Cursor-paginated call log with Load More. */
export function useMcpCalls(
  serverId: string,
  fetcher: (
    serverId: string,
    cursor?: string,
  ) => Promise<{ items: McpCallRow[]; nextCursor: string | null }> = getMcpCalls,
) {
  const [items, setItems] = useState<McpCallRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const loadFirst = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const page = await fetcher(serverId);
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [serverId, fetcher]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoading(true);
    try {
      const page = await fetcher(serverId, nextCursor);
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [serverId, nextCursor, fetcher]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  return { items, nextCursor, loading, errorMessage, loadMore, refetch: loadFirst };
}
