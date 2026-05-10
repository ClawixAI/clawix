import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBrowserSnapshotTool } from './browser-snapshot.js';
import { BrowserSessionManager } from '../browser-session-manager.js';
import { BrowserProviderRegistry } from '../browser-provider-registry.js';
import { BrowserSessionSemaphore } from '../browser-session-semaphore.js';
import { MockBrowserProvider } from '../__tests__/mock-browser-provider.js';
import { stubRunContext } from '../__tests__/run-context-stub.js';
import type { RunContext } from './browser-navigate.js';

interface CdpNode {
  nodeId: string;
  role?: { value: string };
  name?: { value: string };
  childIds?: string[];
  ignored?: boolean;
}

function makeFakeContext(nodes: CdpNode[]) {
  const fakePage = {
    getByRole: vi.fn(() => ({ first: vi.fn(() => ({ click: vi.fn() })) })),
    url: vi.fn(() => 'https://example.com'),
  };
  const cdp = {
    send: vi.fn(async (method: string) => {
      if (method === 'Accessibility.enable') return {};
      if (method === 'Accessibility.getFullAXTree') return { nodes };
      return {};
    }),
    detach: vi.fn(async () => {}),
  };
  const fakeContext = {
    pages: () => [fakePage],
    newPage: vi.fn(async () => fakePage),
    newCDPSession: vi.fn(async () => cdp),
  };
  return { fakeContext, fakePage, cdp };
}

describe('browser_snapshot', () => {
  let mgr: BrowserSessionManager;
  let provider: MockBrowserProvider;
  let ctx: RunContext;

  beforeEach(async () => {
    provider = new MockBrowserProvider();
    Object.defineProperty(provider, 'name', { value: 'local' });
    const registry = new BrowserProviderRegistry();
    registry.register(provider);
    process.env['BROWSER_PROVIDER'] = 'local';
    registry.activate();
    const sem = new BrowserSessionSemaphore({ getQuota: () => 5, queueTimeoutMs: 100 });
    mgr = new BrowserSessionManager(registry, sem);
    ctx = stubRunContext();
    await mgr.acquireForRun({ runId: 'r', userKey: 'u' });
  });

  it('renders an a11y tree as text with @e refs', async () => {
    const { fakeContext } = makeFakeContext([
      {
        nodeId: '1',
        role: { value: 'RootWebArea' },
        name: { value: 'Test Page' },
        childIds: ['2', '3'],
      },
      { nodeId: '2', role: { value: 'link' }, name: { value: 'Home' } },
      { nodeId: '3', role: { value: 'button' }, name: { value: 'Buy' } },
    ]);
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(fakeContext as never);

    const tool = createBrowserSnapshotTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(false);
    expect(result.output).toContain('@e1');
    expect(result.output).toContain('@e2');
    expect(result.output).toContain('Home');
    expect(result.output).toContain('Buy');
    expect(mgr.getSnapshotRefs('r')?.size).toBe(2);
  });

  it('returns navigate first error when context is null', async () => {
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(null);

    const tool = createBrowserSnapshotTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigate first/i);
  });

  it('returns navigate first error when context has no pages', async () => {
    const fakeContext = {
      pages: () => [],
      newPage: vi.fn(),
      newCDPSession: vi.fn(),
    };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(fakeContext as never);

    const tool = createBrowserSnapshotTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigate first/i);
  });

  it('full=true includes nodes without names', async () => {
    const { fakeContext } = makeFakeContext([
      {
        nodeId: '1',
        role: { value: 'RootWebArea' },
        name: { value: 'Test Page' },
        childIds: ['2', '3', '4'],
      },
      { nodeId: '2', role: { value: 'link' }, name: { value: 'Home' } },
      { nodeId: '3', role: { value: 'button' }, name: { value: '' } },
      { nodeId: '4', role: { value: 'none' }, name: { value: '' } },
    ]);
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(fakeContext as never);

    const tool = createBrowserSnapshotTool(mgr, () => ctx);

    const compactResult = await tool.execute({ full: false });
    expect(compactResult.isError).toBe(false);
    const compactRefs = mgr.getSnapshotRefs('r');
    expect(compactRefs?.size).toBe(1);

    const fullResult = await tool.execute({ full: true });
    expect(fullResult.isError).toBe(false);
    const fullRefs = mgr.getSnapshotRefs('r');
    // The walker skips the root and walks its 3 children
    expect(fullRefs!.size).toBe(3);
  });

  it('handles empty AX node list', async () => {
    const { fakeContext } = makeFakeContext([]);
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(fakeContext as never);

    const tool = createBrowserSnapshotTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(false);
    expect(result.output).toBeTruthy();
  });

  it('skips locator creation for Chrome-internal roles', async () => {
    const { fakeContext, fakePage } = makeFakeContext([
      {
        nodeId: '1',
        role: { value: 'RootWebArea' },
        name: { value: 'Page' },
        childIds: ['2', '3'],
      },
      { nodeId: '2', role: { value: 'StaticText' }, name: { value: 'Hello' } },
      { nodeId: '3', role: { value: 'link' }, name: { value: 'Click' } },
    ]);
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(fakeContext as never);

    const tool = createBrowserSnapshotTool(mgr, () => ctx);
    await tool.execute({});

    // getByRole should be called only for the 'link' node, not for StaticText
    expect(fakePage.getByRole).toHaveBeenCalledTimes(1);
    expect(fakePage.getByRole).toHaveBeenCalledWith('link', { name: 'Click' });
  });

  it('detaches the CDP session even on failure', async () => {
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === 'Accessibility.enable') return {};
        throw new Error('boom');
      }),
      detach: vi.fn(async () => {}),
    };
    const fakeContext = {
      pages: () => [{ url: () => 'https://x' }],
      newPage: vi.fn(),
      newCDPSession: vi.fn(async () => cdp),
    };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(fakeContext as never);

    const tool = createBrowserSnapshotTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(cdp.detach).toHaveBeenCalled();
  });
});
