/**
 * Integration test — browser_navigate tool with the real clawix-browser sidecar.
 *
 * Gate: only runs when INTEGRATION=true is set.
 *
 * Requires:
 *   BROWSER_AUTH_TOKEN   — must match the value passed to the sidecar's TOKEN env var
 *   BROWSER_SIDECAR_URL  — WebSocket URL for the sidecar (default: ws://localhost:3001)
 *
 * Note on the navigation target: the test navigates to https://example.com/ rather
 * than an in-process HTTP server. Using a local HTTP server would require the Docker
 * Compose service to carry the --add-host=host.docker.internal:host-gateway extra_host
 * mapping, which is not present in the current docker-compose.dev.yml. The public
 * example.com is stable and universally reachable in most dev/CI environments. If the
 * environment has no outbound internet, swap the URL for a service reachable within
 * the Docker network.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupBrowserIntegration, teardownBrowserIntegration } from './setup.js';
import { LocalProvider } from '../../../src/engine/tools/browser/providers/local-provider.js';
import { BrowserProviderRegistry } from '../../../src/engine/tools/browser/browser-provider-registry.js';
import { BrowserSessionSemaphore } from '../../../src/engine/tools/browser/browser-session-semaphore.js';
import { BrowserSessionManager } from '../../../src/engine/tools/browser/browser-session-manager.js';
import { createBrowserNavigateTool } from '../../../src/engine/tools/browser/tools/browser-navigate.js';
import { stubRunContext } from '../../../src/engine/tools/browser/__tests__/run-context-stub.js';
import { BrowserProviderUnavailableError } from '../../../src/engine/tools/browser/browser-provider.js';

const INTEGRATION = process.env['INTEGRATION'] === 'true';

beforeAll(async () => {
  if (!INTEGRATION) return;
  await setupBrowserIntegration();
}, 90_000);

afterAll(async () => {
  if (!INTEGRATION) return;
  await teardownBrowserIntegration();
});

describe.skipIf(!INTEGRATION)('browser_navigate (integration)', () => {
  /** Build a fresh manager/tool wired to the real sidecar. */
  function buildTool(runId: string): {
    tool: ReturnType<typeof createBrowserNavigateTool>;
    mgr: BrowserSessionManager;
    ctx: ReturnType<typeof stubRunContext>;
  } {
    process.env['BROWSER_PROVIDER'] = 'local';
    process.env['BROWSER_SIDECAR_URL'] =
      process.env['BROWSER_SIDECAR_URL'] ?? 'ws://localhost:3001';
    process.env['BROWSER_AUTH_TOKEN'] = process.env['BROWSER_AUTH_TOKEN'] ?? 'test-token';

    const provider = new LocalProvider();
    const registry = new BrowserProviderRegistry();
    registry.register(provider);
    registry.activate();

    const sem = new BrowserSessionSemaphore({ getQuota: () => 5, queueTimeoutMs: 15_000 });
    const mgr = new BrowserSessionManager(registry, sem);
    const ctx = stubRunContext({ runId, userId: 'int-u' });
    const tool = createBrowserNavigateTool(mgr, () => ctx);

    return { tool, mgr, ctx };
  }

  it('navigates to example.com via the LocalProvider sidecar', async () => {
    const { tool, mgr } = buildTool('int-navigate-r1');
    try {
      const result = await tool.execute({ url: 'https://example.com/' });
      expect(result.isError).toBe(false);
      const body = JSON.parse(result.output) as { title: string; status: number };
      expect(body.title.toLowerCase()).toContain('example');
      expect(body.status).toBe(200);
    } finally {
      await mgr.releaseIfActive('int-navigate-r1');
    }
  }, 60_000);

  it('blocks navigation to a private/loopback address via the URL validator', async () => {
    const { tool, mgr } = buildTool('int-navigate-r2');
    try {
      // 127.0.0.1 is a loopback address; the SSRF validator must reject this
      // before the request ever reaches the sidecar.
      const result = await tool.execute({ url: 'http://127.0.0.1:5432/' });
      expect(result.isError).toBe(true);
    } finally {
      await mgr.releaseIfActive('int-navigate-r2');
    }
  }, 30_000);

  it('refuses CDP connect when the wrong auth token is presented', async () => {
    // Temporarily override the token with a wrong value.
    const original = process.env['BROWSER_AUTH_TOKEN'];
    process.env['BROWSER_AUTH_TOKEN'] = 'definitely-wrong-token';

    try {
      const provider = new LocalProvider();
      await expect(provider.acquireSession('int-bad-token-run')).rejects.toThrow(
        BrowserProviderUnavailableError,
      );
    } finally {
      if (original !== undefined) {
        process.env['BROWSER_AUTH_TOKEN'] = original;
      } else {
        delete process.env['BROWSER_AUTH_TOKEN'];
      }
      // Clean up any dangling session (should not exist, but be safe).
    }
  }, 30_000);
});
