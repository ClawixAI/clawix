const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

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
  options: RequestInit & { accessToken?: string } = {},
): Promise<T> {
  const { accessToken, headers, body, ...rest } = options;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    body,
    cache: 'no-store',
    // Send/receive cookies cross-origin so the httpOnly clawix_refresh
    // cookie reaches /auth/refresh and /auth/logout.
    credentials: 'include',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(headers as Record<string, string>),
    },
  });

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
  return res.json() as Promise<T>;
}
