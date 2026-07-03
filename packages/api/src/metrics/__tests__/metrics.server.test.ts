import { describe, it, expect, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';

// Side-effect import: register the agent-loop counters on the default registry
// so the serialized scrape output includes them.
import '../../engine/agent-loop-metrics.js';
import {
  startMetricsServer,
  resolveMetricsServerOptions,
  installMetricsShutdown,
} from '../metrics.server.js';

const silentLogger = { info: () => {}, warn: () => {} } as unknown as Logger;

describe('metrics server', () => {
  let server: FastifyInstance | null = null;

  afterEach(async () => {
    if (server) await server.close();
    server = null;
  });

  it('defaults to loopback bind on port 9091 (fail-closed)', () => {
    const opts = resolveMetricsServerOptions({} as NodeJS.ProcessEnv);
    expect(opts.host).toBe('127.0.0.1');
    expect(opts.port).toBe(9091);
  });

  it('honors METRICS_BIND_IP and METRICS_PORT overrides', () => {
    const opts = resolveMetricsServerOptions({
      METRICS_BIND_IP: '0.0.0.0',
      METRICS_PORT: '9200',
    } as unknown as NodeJS.ProcessEnv);
    expect(opts.host).toBe('0.0.0.0');
    expect(opts.port).toBe(9200);
  });

  it('falls back to loopback/9091 when the env vars are present but empty', () => {
    // A bare `METRICS_BIND_IP:` line in compose yields '' (not nullish). It must
    // NOT bind all interfaces, and '' must not make the port Number('') === 0.
    const opts = resolveMetricsServerOptions({
      METRICS_BIND_IP: '',
      METRICS_PORT: '',
    } as unknown as NodeJS.ProcessEnv);
    expect(opts.host).toBe('127.0.0.1');
    expect(opts.port).toBe(9091);
  });

  it('serves the prom registry with the prometheus content type', async () => {
    server = await startMetricsServer(silentLogger, { enabled: true, port: 0, host: '127.0.0.1' });
    expect(server).not.toBeNull();

    const address = server!.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/metrics`);

    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('clawix_agent_active_slots');
  });

  it('is disabled by default (METRICS_ENABLED unset)', () => {
    expect(resolveMetricsServerOptions({} as NodeJS.ProcessEnv).enabled).toBe(false);
  });

  it('enables only on the exact string "true"', () => {
    const on = resolveMetricsServerOptions({
      METRICS_ENABLED: 'true',
    } as unknown as NodeJS.ProcessEnv);
    const off = resolveMetricsServerOptions({
      METRICS_ENABLED: '1',
    } as unknown as NodeJS.ProcessEnv);
    expect(on.enabled).toBe(true);
    expect(off.enabled).toBe(false);
  });

  it('does not start a listener when disabled', async () => {
    const result = await startMetricsServer(silentLogger, {
      enabled: false,
      port: 0,
      host: '127.0.0.1',
    });
    expect(result).toBeNull();
  });

  it('installs no signal handlers when metrics are disabled (preserves default termination)', () => {
    const once = vi.spyOn(process, 'once').mockImplementation(() => process);
    installMetricsShutdown(null, silentLogger);
    expect(once).not.toHaveBeenCalled();
    once.mockRestore();
  });

  it('installs SIGTERM and SIGINT handlers when metrics are enabled', () => {
    const once = vi.spyOn(process, 'once').mockImplementation(() => process);
    const fakeServer = {
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as FastifyInstance;
    installMetricsShutdown(fakeServer, silentLogger);
    expect(once).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(once).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    once.mockRestore();
  });
});
