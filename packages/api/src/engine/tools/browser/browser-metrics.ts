/**
 * Prometheus metrics for browser session lifecycle.
 *
 * Registered once at module load time. prom-client errors on duplicate
 * registration, so these are module-level singletons.
 */

import { Gauge, Histogram } from 'prom-client';

export const browserSessionsActive = new Gauge({
  name: 'clawix_browser_sessions_active',
  help: 'Active browser sessions',
  labelNames: ['provider'] as const,
});

export const browserSessionDuration = new Histogram({
  name: 'clawix_browser_session_duration_ms',
  help: 'Duration of browser sessions in milliseconds',
  buckets: [100, 500, 1_000, 5_000, 15_000, 60_000, 300_000],
});
