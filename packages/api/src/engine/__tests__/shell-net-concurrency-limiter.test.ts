import { describe, it, expect } from 'vitest';
import { ShellNetConcurrencyLimiter } from '../tools/shell-net-concurrency-limiter.js';

describe('ShellNetConcurrencyLimiter', () => {
  it('allows up to cap concurrent runs per user', () => {
    const l = new ShellNetConcurrencyLimiter();
    l.acquire('u1', 2);
    l.acquire('u1', 2);
    expect(() => l.acquire('u1', 2)).toThrow(/max concurrent shell_net/i);
  });

  it('release frees a slot', () => {
    const l = new ShellNetConcurrencyLimiter();
    l.acquire('u1', 1);
    l.release('u1');
    expect(() => l.acquire('u1', 1)).not.toThrow();
  });

  it('counts users independently', () => {
    const l = new ShellNetConcurrencyLimiter();
    l.acquire('u1', 1);
    expect(() => l.acquire('u2', 1)).not.toThrow();
  });
});
