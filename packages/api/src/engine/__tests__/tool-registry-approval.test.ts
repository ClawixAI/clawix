import { describe, expect, it, vi } from 'vitest';

import { ToolRegistry } from '../tool-registry.js';
import type { Tool } from '../tool.js';

const okTool = (over: Partial<Tool> = {}): Tool => ({
  name: 'wiki_delete',
  description: 'd',
  parameters: { type: 'object', properties: { pageId: { type: 'string' } }, required: ['pageId'] },
  requiresApproval: true,
  approvalScope: 'resource',
  resourceKeyFromParams: (p) => String(p['pageId'] ?? ''),
  execute: vi.fn(async () => ({ output: 'deleted', isError: false })),
  ...over,
});

const ctx = (gate: ReturnType<typeof vi.fn>) => ({
  userId: 'u1',
  agentRunId: 'run1',
  sessionId: 's1',
  isSubAgent: false,
  gate,
});

describe('registration-time validation', () => {
  it("throws for approvalScope 'resource' without an extractor", () => {
    const registry = new ToolRegistry();
    expect(() => registry.register(okTool({ resourceKeyFromParams: undefined }))).toThrow(
      /resource.*without resourceKeyFromParams/,
    );
  });
});

describe('guard at runAndPostProcess', () => {
  it('executes when the gate allows, passing validated params', async () => {
    const gate = vi.fn(async () => ({ allowed: true }));
    const registry = new ToolRegistry();
    registry.setApprovalContext(ctx(gate));
    const tool = okTool();
    registry.register(tool);

    const result = await registry.execute('wiki_delete', { pageId: 'page-a' });
    expect(result.isError).toBe(false);
    expect(gate).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'wiki_delete',
        scopeKind: 'resource',
        resourceKey: 'page-a',
        extractorFailed: false,
      }),
    );
    expect(tool.execute).toHaveBeenCalled();
  });

  it('returns the blocked message as an error result when denied, without executing', async () => {
    const gate = vi.fn(async () => ({ allowed: false, blockedMessage: 'BLOCKED: no' }));
    const registry = new ToolRegistry();
    registry.setApprovalContext(ctx(gate));
    const tool = okTool();
    registry.register(tool);

    const result = await registry.execute('wiki_delete', { pageId: 'page-a' });
    expect(result.isError).toBe(true);
    expect(result.output).toContain('BLOCKED: no');
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('skips the gate entirely for tools without requiresApproval', async () => {
    const gate = vi.fn();
    const registry = new ToolRegistry();
    registry.setApprovalContext(ctx(gate));
    registry.register(
      okTool({
        requiresApproval: undefined,
        approvalScope: undefined,
        resourceKeyFromParams: undefined,
      }),
    );
    await registry.execute('wiki_delete', { pageId: 'page-a' });
    expect(gate).not.toHaveBeenCalled();
  });

  it('blocks approval-requiring tool when no approval context was set (fail-closed)', async () => {
    const registry = new ToolRegistry();
    const tool = okTool();
    registry.register(tool);
    const result = await registry.execute('wiki_delete', { pageId: 'page-a' });
    expect(result.isError).toBe(true);
    expect(result.output).toContain('BLOCKED');
    expect(result.output).toContain('approval context is not initialized');
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('executes normally for tools without requiresApproval when no approval context is set', async () => {
    const registry = new ToolRegistry();
    const tool = okTool({
      requiresApproval: undefined,
      approvalScope: undefined,
      resourceKeyFromParams: undefined,
    });
    registry.register(tool);
    const result = await registry.execute('wiki_delete', { pageId: 'page-a' });
    expect(result.isError).toBe(false);
    expect(tool.execute).toHaveBeenCalled();
  });

  it('extractor throwing → extractorFailed=true, resourceKey empty', async () => {
    const gate = vi.fn(async () => ({ allowed: true }));
    const registry = new ToolRegistry();
    registry.setApprovalContext(ctx(gate));
    registry.register(
      okTool({
        resourceKeyFromParams: () => {
          throw new Error('boom');
        },
      }),
    );
    await registry.execute('wiki_delete', { pageId: 'page-a' });
    expect(gate).toHaveBeenCalledWith(
      expect.objectContaining({ extractorFailed: true, resourceKey: '' }),
    );
  });

  it('gates rawParams (MCP) tools with their raw params', async () => {
    const gate = vi.fn(async () => ({ allowed: true }));
    const registry = new ToolRegistry();
    registry.setApprovalContext(ctx(gate));
    registry.register(
      okTool({
        name: 'mcp__srv__send',
        rawParams: true,
        approvalScope: 'call',
        resourceKeyFromParams: undefined,
        parameters: { type: 'object' },
      }),
    );
    await registry.execute('mcp__srv__send', { anything: true });
    expect(gate).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'mcp__srv__send', scopeKind: 'call', resourceKey: '' }),
    );
  });

  it('forwards abortSignal into the gate input', async () => {
    const gate = vi.fn(async () => ({ allowed: true }));
    const registry = new ToolRegistry();
    registry.setApprovalContext(ctx(gate));
    registry.register(okTool());
    const controller = new AbortController();
    await registry.execute('wiki_delete', { pageId: 'p' }, { abortSignal: controller.signal });
    expect(gate).toHaveBeenCalledWith(expect.objectContaining({ abortSignal: controller.signal }));
  });
});

describe('requiresApprovalForParams (per-call predicate)', () => {
  it('predicate returns false → gate not called, tool executes (approval context set)', async () => {
    const gate = vi.fn(async () => ({ allowed: true }));
    const registry = new ToolRegistry();
    registry.setApprovalContext(ctx(gate));
    const tool = okTool({ requiresApprovalForParams: () => false });
    registry.register(tool);

    const result = await registry.execute('wiki_delete', { pageId: 'page-a' });
    expect(result.isError).toBe(false);
    expect(gate).not.toHaveBeenCalled();
    expect(tool.execute).toHaveBeenCalled();
  });

  it('predicate returns false → tool executes even with NO approval context set (exemption beats fail-closed)', async () => {
    const registry = new ToolRegistry();
    const tool = okTool({ requiresApprovalForParams: () => false });
    registry.register(tool);

    const result = await registry.execute('wiki_delete', { pageId: 'page-a' });
    expect(result.isError).toBe(false);
    expect(tool.execute).toHaveBeenCalled();
  });

  it('predicate returns true → gate called as normal', async () => {
    const gate = vi.fn(async () => ({ allowed: true }));
    const registry = new ToolRegistry();
    registry.setApprovalContext(ctx(gate));
    const tool = okTool({ requiresApprovalForParams: () => true });
    registry.register(tool);

    const result = await registry.execute('wiki_delete', { pageId: 'page-a' });
    expect(result.isError).toBe(false);
    expect(gate).toHaveBeenCalled();
    expect(tool.execute).toHaveBeenCalled();
  });

  it('predicate throws → treated as requiring approval: gate called with context', async () => {
    const gate = vi.fn(async () => ({ allowed: true }));
    const registry = new ToolRegistry();
    registry.setApprovalContext(ctx(gate));
    const tool = okTool({
      requiresApprovalForParams: () => {
        throw new Error('predicate boom');
      },
    });
    registry.register(tool);

    const result = await registry.execute('wiki_delete', { pageId: 'page-a' });
    expect(result.isError).toBe(false);
    expect(gate).toHaveBeenCalled();
    expect(tool.execute).toHaveBeenCalled();
  });

  it('predicate throws → treated as requiring approval: BLOCKED_NO_CONTEXT without context', async () => {
    const registry = new ToolRegistry();
    const tool = okTool({
      requiresApprovalForParams: () => {
        throw new Error('predicate boom');
      },
    });
    registry.register(tool);

    const result = await registry.execute('wiki_delete', { pageId: 'page-a' });
    expect(result.isError).toBe(true);
    expect(result.output).toContain('BLOCKED');
    expect(result.output).toContain('approval context is not initialized');
    expect(tool.execute).not.toHaveBeenCalled();
  });
});
