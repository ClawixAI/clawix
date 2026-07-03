import { describe, it, expect } from 'vitest';

import { RunActivityRegistry } from '../run-activity.registry.js';

describe('RunActivityRegistry', () => {
  it('returns undefined snapshot for an unregistered run', () => {
    const registry = new RunActivityRegistry();
    expect(registry.snapshot('missing')).toBeUndefined();
  });

  it('registers a run and exposes its metadata with a zeroed iteration', () => {
    const registry = new RunActivityRegistry();
    registry.register('run-1', {
      agentName: 'worker',
      sessionId: 'sess-1',
      parentAgentRunId: 'parent-1',
    });

    const snap = registry.snapshot('run-1');
    expect(snap).toEqual({
      agentName: 'worker',
      sessionId: 'sess-1',
      parentAgentRunId: 'parent-1',
      iteration: 0,
      currentToolName: null,
      currentToolStartedAt: null,
    });
  });

  it('defaults optional metadata to null', () => {
    const registry = new RunActivityRegistry();
    registry.register('run-2', {});

    const snap = registry.snapshot('run-2');
    expect(snap?.agentName).toBeNull();
    expect(snap?.sessionId).toBeNull();
    expect(snap?.parentAgentRunId).toBeNull();
  });

  it('records the current iteration', () => {
    const registry = new RunActivityRegistry();
    registry.register('run-1', {});

    registry.recordIteration('run-1', 3);

    expect(registry.snapshot('run-1')?.iteration).toBe(3);
  });

  it('records a tool start with a timestamp and clears it on tool end', () => {
    const registry = new RunActivityRegistry();
    registry.register('run-1', {});

    const before = Date.now();
    registry.recordToolStart('run-1', 'shell');
    const started = registry.snapshot('run-1');
    expect(started?.currentToolName).toBe('shell');
    expect(started?.currentToolStartedAt).toBeGreaterThanOrEqual(before);

    registry.recordToolEnd('run-1');
    const ended = registry.snapshot('run-1');
    expect(ended?.currentToolName).toBeNull();
    expect(ended?.currentToolStartedAt).toBeNull();
  });

  it('removes a run on unregister', () => {
    const registry = new RunActivityRegistry();
    registry.register('run-1', {});
    registry.unregister('run-1');
    expect(registry.snapshot('run-1')).toBeUndefined();
  });

  it('ignores activity updates for unregistered runs', () => {
    const registry = new RunActivityRegistry();
    // None of these should throw for a run that was never registered.
    expect(() => registry.recordIteration('ghost', 1)).not.toThrow();
    expect(() => registry.recordToolStart('ghost', 'shell')).not.toThrow();
    expect(() => registry.recordToolEnd('ghost')).not.toThrow();
    expect(registry.snapshot('ghost')).toBeUndefined();
  });

  it('creates a run-scoped child logger bound to the run context', () => {
    const registry = new RunActivityRegistry();
    const logger = registry.createRunLogger({
      agentRunId: 'run-1',
      sessionId: 'sess-1',
    });
    // A pino logger exposes the standard level methods.
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    // The bound context is discoverable on the logger's bindings.
    expect(logger.bindings()).toMatchObject({ agentRunId: 'run-1', sessionId: 'sess-1' });
  });
});
