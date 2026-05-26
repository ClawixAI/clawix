const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

// Default fetch timeout. Chrome's stack-level default is ~300s, which leaves
// the dashboard stuck "loading…" indefinitely when the API hangs. 30s is a
// safe cap for JSON dashboard reads/writes; pass `timeoutMs` to override per
// call when a known-slow endpoint (e.g. long-running agent invocation) needs
// more headroom.
const DEFAULT_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { accessToken?: string; timeoutMs?: number } = {},
): Promise<T> {
  const { accessToken, headers, body, signal: userSignal, timeoutMs, ...rest } = options;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, timeoutMs ?? DEFAULT_TIMEOUT_MS);

  // Propagate a caller-provided AbortSignal into our internal controller so
  // callers can still cancel (e.g. unmount, user-initiated stop) while we
  // also own the timeout abort.
  const forwardAbort = (): void => {
    controller.abort();
  };
  if (userSignal) {
    if (userSignal.aborted) controller.abort();
    else userSignal.addEventListener('abort', forwardAbort, { once: true });
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      body,
      cache: 'no-store',
      // Send/receive cookies cross-origin so the httpOnly clawix_refresh
      // cookie reaches /auth/refresh and /auth/logout.
      credentials: 'include',
      signal: controller.signal,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(headers as Record<string, string>),
      },
    });
  } catch (err) {
    // Distinguish a timeout abort from a caller-initiated abort so callers
    // (and toast surfaces) can show a meaningful "request timed out" message
    // instead of a generic "AbortError".
    if (controller.signal.aborted && !userSignal?.aborted) {
      throw new ApiError(0, 'Request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeoutHandle);
    if (userSignal) userSignal.removeEventListener('abort', forwardAbort);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ message: res.statusText }))) as {
      message?: string;
    };
    throw new ApiError(res.status, body.message ?? res.statusText);
  }

  const contentLength = res.headers.get('content-length');
  const contentType = res.headers.get('content-type') ?? '';
  if (res.status === 204 || contentLength === '0' || !contentType.includes('application/json')) {
    return undefined as T;
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(0, 'Invalid response from server');
  }
}
