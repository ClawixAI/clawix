/**
 * Prometheus metrics for the Python tool suite (python_run / python_run_net).
 *
 * Registered once at module load time. prom-client errors on duplicate
 * registration, so these are module-level singletons.
 */

import { Counter, Gauge, Histogram } from 'prom-client';

/** Total python_run / python_run_net calls by tool name and exit-code class. */
export const pythonRunTotal = new Counter({
  name: 'clawix_python_run_total',
  help: 'Total python_run / python_run_net calls by tool and exit code class.',
  labelNames: ['tool', 'exit_code'] as const,
});

/** Duration of python_run / python_run_net calls in seconds. */
export const pythonRunDurationSeconds = new Histogram({
  name: 'clawix_python_run_duration_seconds',
  help: 'Duration of python_run / python_run_net calls.',
  labelNames: ['tool'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 300],
});

/** Number of times a given package was installed (keyed by package name). */
export const pythonPackagesInstalledTotal = new Counter({
  name: 'clawix_python_run_packages_installed_total',
  help: 'Number of times a given package was installed.',
  labelNames: ['package'] as const,
});

/** python_run warm-pool hit count. */
export const pythonPoolWarmHits = new Counter({
  name: 'clawix_python_pool_warm_hits_total',
  help: 'python_run pool warm-hit count.',
});

/** python_run cold-start count (new container spawned). */
export const pythonPoolColdStarts = new Counter({
  name: 'clawix_python_pool_cold_starts_total',
  help: 'python_run pool cold-start count.',
});

/** 1 if the PyPI proxy sidecar is healthy, 0 otherwise. */
export const pythonProxyHealthy = new Gauge({
  name: 'clawix_python_proxy_healthy',
  help: '1 if PyPI proxy healthy, 0 otherwise.',
});

// ------------------------------------------------------------------ //
//  Helpers                                                             //
// ------------------------------------------------------------------ //

/**
 * Map a numeric exit code to a human-readable Prometheus label value.
 * Keeps the cardinality bounded to a small, known set of strings.
 */
export function classifyExit(code: number): string {
  if (code === 0) return 'success';
  if (code === 124) return 'timeout';
  if (code === 137) return 'oom';
  if (code === -1) return 'cancelled';
  return 'error';
}
