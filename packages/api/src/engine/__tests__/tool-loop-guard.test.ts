import { describe, expect, it } from 'vitest';
import { ToolLoopGuard } from '../tool-loop-guard.js';
import { LoopAbortedError } from '../error-classifier.js';

describe('ToolLoopGuard', () => {
  it('does not throw on a single failure', () => {
    const g = new ToolLoopGuard();
    expect(() => g.record('web_search', { q: 'x' }, true)).not.toThrow();
  });

  it('does not throw on two consecutive identical failures', () => {
    const g = new ToolLoopGuard();
    g.record('web_search', { q: 'x' }, true);
    expect(() => g.record('web_search', { q: 'x' }, true)).not.toThrow();
  });

  it('throws LoopAbortedError on the third consecutive identical failure', () => {
    const g = new ToolLoopGuard();
    g.record('web_search', { q: 'x' }, true);
    g.record('web_search', { q: 'x' }, true);
    expect(() => g.record('web_search', { q: 'x' }, true)).toThrow(LoopAbortedError);
  });

  it('throws with the offending tool name and args attached', () => {
    const g = new ToolLoopGuard();
    g.record('web_search', { q: 'x' }, true);
    g.record('web_search', { q: 'x' }, true);
    try {
      g.record('web_search', { q: 'x' }, true);
      expect.fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(LoopAbortedError);
      const err = e as LoopAbortedError;
      expect(err.toolName).toBe('web_search');
      expect(err.args).toEqual({ q: 'x' });
    }
  });

  it('resets on a successful call', () => {
    const g = new ToolLoopGuard();
    g.record('web_search', { q: 'x' }, true);
    g.record('web_search', { q: 'x' }, true);
    g.record('web_search', { q: 'x' }, false); // success
    expect(() => g.record('web_search', { q: 'x' }, true)).not.toThrow();
    expect(() => g.record('web_search', { q: 'x' }, true)).not.toThrow();
    // Now we have 2 consecutive failures again — third would throw.
    expect(() => g.record('web_search', { q: 'x' }, true)).toThrow(LoopAbortedError);
  });

  it('resets on a different-tool call', () => {
    const g = new ToolLoopGuard();
    g.record('web_search', { q: 'x' }, true);
    g.record('web_search', { q: 'x' }, true);
    g.record('web_fetch', { url: 'y' }, true);
    expect(() => g.record('web_search', { q: 'x' }, true)).not.toThrow();
  });

  it('resets on same-tool different-args', () => {
    const g = new ToolLoopGuard();
    g.record('web_search', { q: 'x' }, true);
    g.record('web_search', { q: 'x' }, true);
    g.record('web_search', { q: 'y' }, true); // different args
    expect(() => g.record('web_search', { q: 'x' }, true)).not.toThrow();
  });

  it('treats reordered keys as identical args', () => {
    const g = new ToolLoopGuard();
    g.record('web_search', { q: 'x', limit: 10 }, true);
    g.record('web_search', { limit: 10, q: 'x' }, true); // same args, key order differs
    expect(() => g.record('web_search', { q: 'x', limit: 10 }, true)).toThrow(LoopAbortedError);
  });
});
