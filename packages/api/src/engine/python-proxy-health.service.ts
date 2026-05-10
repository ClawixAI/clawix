/**
 * PythonProxyHealthService — polls the PyPI proxy sidecar and exposes
 * `isHealthy()` for tools that need to decide whether package installs
 * can be served.
 */
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createLogger } from '@clawix/shared';

import { pythonProxyHealthy } from './tools/python/python-metrics.js';

const logger = createLogger('engine:python-proxy-health');

const DEFAULT_URL = 'http://clawix-pypi-proxy:3141';
const PROBE_INTERVAL_MS = 30_000;
const PROBE_TIMEOUT_MS = 5_000;

@Injectable()
export class PythonProxyHealthService implements OnModuleInit, OnModuleDestroy {
  private healthy = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  isHealthy(): boolean {
    return this.healthy;
  }

  async onModuleInit(): Promise<void> {
    await this.probeOnce();
    this.timer = setInterval(() => {
      this.probeOnce().catch(() => undefined);
    }, PROBE_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async probeOnce(): Promise<void> {
    const baseUrl = process.env['PYTHON_PROXY_URL'] ?? DEFAULT_URL;
    const probeUrl = `${baseUrl.replace(/\/$/, '')}/+api`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(probeUrl, { signal: controller.signal });
      const wasHealthy = this.healthy;
      this.healthy = res.ok;
      pythonProxyHealthy.set(this.healthy ? 1 : 0);
      if (this.healthy !== wasHealthy) {
        logger.info({ healthy: this.healthy, status: res.status }, 'PyPI proxy health changed');
      }
    } catch (err) {
      const wasHealthy = this.healthy;
      this.healthy = false;
      pythonProxyHealthy.set(0);
      if (wasHealthy) {
        logger.warn({ err: (err as Error).message }, 'PyPI proxy health probe failed');
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
