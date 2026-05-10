import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBrowserDialogTool } from './browser-dialog.js';
import { BrowserSessionManager } from '../browser-session-manager.js';
import { BrowserProviderRegistry } from '../browser-provider-registry.js';
import { BrowserSessionSemaphore } from '../browser-session-semaphore.js';
import { MockBrowserProvider } from '../__tests__/mock-browser-provider.js';
import { stubRunContext } from '../__tests__/run-context-stub.js';
import type { RunContext } from './browser-navigate.js';

describe('browser_dialog', () => {
  let mgr: BrowserSessionManager;
  let ctx: RunContext;

  beforeEach(async () => {
    const provider = new MockBrowserProvider();
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

  it('returns validation error when action is missing', async () => {
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [{ on: vi.fn() }],
    } as never);

    const tool = createBrowserDialogTool(mgr, () => ctx);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/validation/i);
    expect(result.output).toMatch(/action/i);
  });

  it('returns validation error for invalid action value', async () => {
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [{ on: vi.fn() }],
    } as never);

    const tool = createBrowserDialogTool(mgr, () => ctx);
    const result = await tool.execute({ action: 'click' });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/validation/i);
    expect(result.output).toMatch(/action/i);
  });

  it('returns navigate-first error when getPlaywrightContext returns null', async () => {
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue(null);

    const tool = createBrowserDialogTool(mgr, () => ctx);
    const result = await tool.execute({ action: 'accept' });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/navigate first/i);
  });

  it('returns error when there is no pending dialog', async () => {
    const fakePage = { on: vi.fn() };
    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [fakePage],
    } as never);

    const tool = createBrowserDialogTool(mgr, () => ctx);
    const result = await tool.execute({ action: 'accept' });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/no pending dialog/i);
  });

  it('accepts a dialog and removes it from the buffer', async () => {
    const capturedHandlers: { event: string; listener: (...args: unknown[]) => void }[] = [];
    const fakePage = {
      on(event: string, listener: (...args: unknown[]) => void) {
        capturedHandlers.push({ event, listener });
      },
    };

    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [fakePage],
    } as never);

    // Attach listeners by triggering the tool once (it will error on no dialog, that's ok)
    const tool = createBrowserDialogTool(mgr, () => ctx);
    await tool.execute({ action: 'accept' }); // no dialog yet, just wires listeners

    // Simulate a dialog event
    const acceptMock = vi.fn(async () => {});
    const dismissMock = vi.fn(async () => {});

    const dialogHandler = capturedHandlers.find((h) => h.event === 'dialog');
    expect(dialogHandler).toBeDefined();
    dialogHandler!.listener({
      type: () => 'confirm',
      message: () => 'Are you sure?',
      accept: acceptMock,
      dismiss: dismissMock,
    });

    // Now accept
    const result = await tool.execute({ action: 'accept' });
    expect(result.isError).toBe(false);

    const payload = JSON.parse(result.output) as { ok: boolean; type: string };
    expect(payload).toMatchObject({ ok: true, type: 'confirm' });

    // accept should have been called, dismiss should not
    expect(acceptMock).toHaveBeenCalledOnce();
    expect(dismissMock).not.toHaveBeenCalled();

    // Buffer should now be empty
    expect(mgr.peekPendingDialog('r')).toBeNull();
  });

  it('dismisses a dialog and removes it from the buffer', async () => {
    const capturedHandlers: { event: string; listener: (...args: unknown[]) => void }[] = [];
    const fakePage = {
      on(event: string, listener: (...args: unknown[]) => void) {
        capturedHandlers.push({ event, listener });
      },
    };

    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [fakePage],
    } as never);

    const tool = createBrowserDialogTool(mgr, () => ctx);
    await tool.execute({ action: 'dismiss' }); // attach listeners

    const acceptMock = vi.fn(async () => {});
    const dismissMock = vi.fn(async () => {});

    const dialogHandler = capturedHandlers.find((h) => h.event === 'dialog');
    dialogHandler!.listener({
      type: () => 'alert',
      message: () => 'Hello!',
      accept: acceptMock,
      dismiss: dismissMock,
    });

    const result = await tool.execute({ action: 'dismiss' });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.output)).toMatchObject({ ok: true, type: 'alert' });

    expect(dismissMock).toHaveBeenCalledOnce();
    expect(acceptMock).not.toHaveBeenCalled();
    expect(mgr.peekPendingDialog('r')).toBeNull();
  });

  it('passes text to accept for prompt dialogs', async () => {
    const capturedHandlers: { event: string; listener: (...args: unknown[]) => void }[] = [];
    const fakePage = {
      on(event: string, listener: (...args: unknown[]) => void) {
        capturedHandlers.push({ event, listener });
      },
    };

    vi.spyOn(mgr, 'getPlaywrightContext').mockReturnValue({
      pages: () => [fakePage],
    } as never);

    const tool = createBrowserDialogTool(mgr, () => ctx);
    await tool.execute({ action: 'accept' }); // attach listeners

    const acceptMock = vi.fn(async (_text?: string) => {});
    const dismissMock = vi.fn(async () => {});

    const dialogHandler = capturedHandlers.find((h) => h.event === 'dialog');
    dialogHandler!.listener({
      type: () => 'prompt',
      message: () => 'Enter your name:',
      accept: acceptMock,
      dismiss: dismissMock,
    });

    const result = await tool.execute({ action: 'accept', text: 'Alice' });
    expect(result.isError).toBe(false);
    expect(acceptMock).toHaveBeenCalledWith('Alice');
  });
});
