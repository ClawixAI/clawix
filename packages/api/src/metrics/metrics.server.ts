import Fastify, { type FastifyInstance } from 'fastify';
import { collectDefaultMetrics, register } from 'prom-client';
import type { Logger } from 'pino';

/**
 * Standalone Prometheus scrape server — deliberately NOT part of the Nest app.
 *
 * Why a separate listener: the public API (port 3001) and /metrics must not
 * share a port. While they do, network isolation is impossible — anyone who can
 * reach the API can scrape metrics. This binds its OWN port (METRICS_PORT,
 * default 9091) so the scrape surface is separable from the public API surface.
 *
 * Bind address (METRICS_BIND_IP, default 127.0.0.1 = loopback / zero exposure):
 *   - unset -> 127.0.0.1: airtight. Scrape with a Prometheus that shares this
 *       container's network namespace (compose `network_mode: service:api`)
 *       hitting localhost:9091. Ships as the default (Recipe A).
 *   - <internal-ip>: bind the container's clawix-internal address so a normal
 *       networked Prometheus on clawix-internal can scrape it while the
 *       clawix-browser-egress interface is NOT listening (Recipe B).
 *   - 0.0.0.0: listens on ALL container interfaces, including
 *       clawix-browser-egress where the Chromium sidecar (renders hostile pages)
 *       lives. Documented residual — operator opt-in (Recipe C).
 *
 * The engine `*-metrics.ts` modules register their counters/gauges on the
 * prom-client default `register` via side-effect imports triggered when the
 * Nest app loads its engine services. This server just serializes that global
 * registry; it MUST be started after the Nest app is built so the registry is
 * populated (see main.ts).
 */

/** Guard so repeated calls (e.g. tests) can't double-register default metrics. */
let defaultsCollected = false;

export interface MetricsServerOptions {
  enabled: boolean;
  port: number;
  host: string;
}

/**
 * Resolve enable-flag / port / bind-address from env, secure-by-default.
 *
 * `enabled` is off unless METRICS_ENABLED is exactly 'true' (matching the
 * codebase's `x === 'true'` env-boolean convention) — unset/empty/'false'/'1'
 * all mean disabled. Uses `||` (not `??`) for host/port so an empty-string env
 * value falls back to the safe default instead of binding all interfaces or
 * making the port `Number('') === 0`.
 */
export function resolveMetricsServerOptions(
  env: NodeJS.ProcessEnv = process.env,
): MetricsServerOptions {
  return {
    enabled: env['METRICS_ENABLED'] === 'true',
    port: Number(env['METRICS_PORT'] || 9091),
    host: env['METRICS_BIND_IP'] || '127.0.0.1',
  };
}

/**
 * Start the metrics server. Failure-isolated: a bind error is logged at warn
 * and resolves to `null` (metrics disabled) so the API keeps serving — it must
 * never ride the process-level unhandledRejection net in main.ts.
 */
export async function startMetricsServer(
  logger: Logger,
  opts: MetricsServerOptions = resolveMetricsServerOptions(),
): Promise<FastifyInstance | null> {
  if (!opts.enabled) {
    logger.info('Metrics server disabled (set METRICS_ENABLED=true to enable)');
    return null;
  }

  if (!defaultsCollected) {
    // Node.js process metrics (heap, event-loop lag, GC) alongside the
    // agent-loop counters. Guarded so repeated instantiation can't throw.
    collectDefaultMetrics();
    defaultsCollected = true;
  }

  const server = Fastify({ logger: false });
  server.get('/metrics', async (_request, reply) => {
    reply.header('Content-Type', register.contentType);
    return register.metrics();
  });

  try {
    await server.listen({ port: opts.port, host: opts.host });
    logger.info({ port: opts.port, host: opts.host }, 'Metrics server listening');
    // `await` because a Fastify instance is thenable — returning it bare would
    // let a rejection escape this try/catch (satisfies @typescript-eslint/return-await).
    return await server;
  } catch (err) {
    logger.warn(
      { err, port: opts.port, host: opts.host },
      'Metrics server failed to bind — metrics disabled, API continues',
    );
    return null;
  }
}

/**
 * Wire SIGTERM/SIGINT to close the metrics server before the process exits.
 *
 * The metrics server lives outside Nest, so its lifecycle is managed outside
 * Nest too — this frees the port on `nest start --watch` reloads (dev) and on
 * container stop (prod).
 *
 * Critical: when `server` is null (the default, metrics-off path), this
 * installs NO handler at all. Attaching even a no-op listener to
 * SIGTERM/SIGINT removes Node's default "terminate on signal" behavior, which
 * would otherwise hang the process (kept alive by the Fastify API server)
 * until Docker's SIGKILL grace period expires. When metrics ARE enabled, the
 * handler closes the metrics server and then re-raises the signal so Node's
 * default termination still runs — it does not swallow the exit.
 */
export function installMetricsShutdown(server: FastifyInstance | null, logger: Logger): void {
  if (!server) return; // metrics-off default: install nothing, preserve Node's default signal termination

  const shutdown = (signal: NodeJS.Signals): void => {
    server
      .close()
      .catch((err: unknown) => {
        logger.warn({ err }, 'Metrics server close failed');
      })
      .finally(() => {
        // Re-raise so Node's default termination runs (the `once` listener is
        // already removed by the time this fires). Matches prior shutdown behavior.
        process.kill(process.pid, signal);
      });
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
