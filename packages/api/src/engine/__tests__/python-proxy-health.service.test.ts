import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PythonProxyHealthService } from '../python-proxy-health.service';

describe('PythonProxyHealthService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns false before first probe completes', () => {
    const svc = new PythonProxyHealthService();
    expect(svc.isHealthy()).toBe(false);
  });

  it('returns true after a 200 probe', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
    const svc = new PythonProxyHealthService();
    await svc.probeOnce();
    expect(svc.isHealthy()).toBe(true);
  });

  it('returns false after a non-200 probe', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 } as Response);
    const svc = new PythonProxyHealthService();
    await svc.probeOnce();
    expect(svc.isHealthy()).toBe(false);
  });

  it('returns false after a network error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const svc = new PythonProxyHealthService();
    await svc.probeOnce();
    expect(svc.isHealthy()).toBe(false);
  });

  it('reads PYTHON_PROXY_URL from env (default if unset)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
    process.env.PYTHON_PROXY_URL = 'http://custom:9000';
    try {
      const svc = new PythonProxyHealthService();
      await svc.probeOnce();
      expect(fetchMock).toHaveBeenCalledWith('http://custom:9000/+api', expect.any(Object));
    } finally {
      delete process.env.PYTHON_PROXY_URL;
    }
  });
});
