import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditLogRepository } from '../db/audit-log.repository.js';

/** Routes that should NOT be audit-logged. */
const EXCLUDED_PATHS = [
  '/api/v1/chat', // conversation fetching
  '/api/v1/tokens', // read-only governance queries
  '/api/v1/audit', // reading audit logs themselves
  '/auth/login', // auth has its own logging
  '/auth/refresh',
  '/health',
];

/** Map HTTP method + path prefix to a human-readable action. */
function deriveAction(method: string, path: string): string {
  // Extract resource from path: /api/v1/agents → agents, /admin/users → users
  const segments = path.split('/').filter(Boolean);
  // Find the resource segment (skip 'api', 'v1', 'admin')
  const skipPrefixes = new Set(['api', 'v1', 'admin']);
  const resourceSegment = segments.find((s) => !skipPrefixes.has(s)) ?? 'unknown';

  const verb =
    method === 'POST'
      ? 'create'
      : method === 'PATCH' || method === 'PUT'
        ? 'update'
        : method === 'DELETE'
          ? 'delete'
          : 'read';

  return `${resourceSegment}.${verb}`;
}

/** Extract resource type from path. */
function deriveResource(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const skipPrefixes = new Set(['api', 'v1', 'admin']);
  return segments.find((s) => !skipPrefixes.has(s)) ?? 'unknown';
}

/** Extract resource ID from path (last CUID-like segment). */
function deriveResourceId(path: string): string {
  const segments = path.split('/').filter(Boolean);
  // Find the last segment that looks like an ID (not a route name)
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i]!;
    // CUID pattern: 25+ chars starting with 'c'
    if (/^c[a-z0-9]{24,}$/.test(s)) return s;
  }
  return 'n/a';
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly auditLogRepo: AuditLogRepository) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      method: string;
      url: string;
      user?: { sub: string };
      ip?: string;
    }>();

    const method = req.method;

    // Only log mutating requests
    if (method !== 'POST' && method !== 'PATCH' && method !== 'PUT' && method !== 'DELETE') {
      return next.handle();
    }

    // Strip query params for path matching
    const path = req.url.split('?')[0] ?? req.url;

    // Skip excluded paths
    if (EXCLUDED_PATHS.some((excluded) => path.startsWith(excluded))) {
      return next.handle();
    }

    // Must have authenticated user
    const userId = req.user?.sub;
    if (!userId) {
      return next.handle();
    }

    const action = deriveAction(method, path);
    const resource = deriveResource(path);
    const resourceId = deriveResourceId(path);

    return next.handle().pipe(
      tap({
        next: (responseBody) => {
          // Extract ID from response if we didn't find one in the path
          const effectiveResourceId =
            resourceId !== 'n/a'
              ? resourceId
              : typeof responseBody === 'object' && responseBody !== null && 'id' in responseBody
                ? String((responseBody as { id: string }).id)
                : 'n/a';

          // Fire and forget — don't block the response
          void this.auditLogRepo
            .create({
              userId,
              action,
              resource,
              resourceId: effectiveResourceId,
              details: { method, path },
              ipAddress: req.ip,
            })
            .catch(() => {
              // Silently ignore audit log failures — never block business logic
            });
        },
      }),
    );
  }
}
