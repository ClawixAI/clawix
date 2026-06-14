import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as dns from 'dns';
import { createBrowserNavigateTool } from './browser-navigate.js';
import { BrowserSessionManager } from '../browser-session-manager.js';
import { BrowserProviderRegistry } from '../browser-provider-registry.js';
import { BrowserSessionSemaphore } from '../browser-session-semaphore.js';
import { MockBrowserProvider } from '../__tests__/mock-browser-provider.js';
import { stubRunContext } from '../__tests__/run-context-stub.js';
import type { RunContext } from './browser-navigate.js';

describe('browser_navigate', () => {
  let mgr: BrowserSessionManager;
  let provider: MockBrowserProvider;
  let ctx: RunContext;

  beforeEach(() => {
    // The SSRF guard in validateUrl() resolves the hostname via a real
    // dns.promises.lookup(). Left live, this unit test depends on network DNS
    // and starves past the default 5s test timeout under the full parallel
    // suite. Stub it to a stable public IP so the test exercises only the
    // session-acquisition wiring it actually cares about.
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({
      address: '93.184.216.34',
      family: 4,
    } as never);

    provider = new MockBrowserProvider();
    Object.defineProperty(provider, 'name', { value: 'local' });
    const registry = new BrowserProviderRegistry();
    registry.register(provider);
    process.env['BROWSER_PROVIDER'] = 'local';
    registry.activate();
    const sem = new BrowserSessionSemaphore({ getQuota: () => 5, queueTimeoutMs: 100 });
    mgr = new BrowserSessionManager(registry, sem);
    ctx = stubRunContext({ runId: 'run-A', userId: 'user-A' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects missing url parameter', async () => {
    const tool = createBrowserNavigateTool(mgr, () => ctx);
    const result = await tool.execute({});
    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/url is required/i);
  });

  it('rejects denylisted URL schemes', async () => {
    const tool = createBrowserNavigateTool(mgr, () => ctx);
    const result = await tool.execute({ url: 'javascript:alert(1)' });
    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/scheme blocked/i);
  });

  it('acquires a session via the manager on first call', async () => {
    const tool = createBrowserNavigateTool(mgr, () => ctx);
    const result = await tool.execute({ url: 'https://example.com/' });
    expect(provider.calls.some((c) => c.op === 'acquire' && c.runId === 'run-A')).toBe(true);
    expect(result).toBeDefined();
  });
});
