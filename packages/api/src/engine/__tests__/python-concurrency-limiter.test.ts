import { describe, it, expect, beforeEach } from 'vitest';
import { PythonConcurrencyLimiter } from '../tools/python/concurrency-limiter';
import { PythonToolError } from '../tools/python/types';

describe('PythonConcurrencyLimiter', () => {
  let limiter: PythonConcurrencyLimiter;

  beforeEach(() => {
    limiter = new PythonConcurrencyLimiter();
  });

  it('admits up to the cap', () => {
    limiter.acquire('u1', 2);
    limiter.acquire('u1', 2);
  });

  it('rejects beyond the cap', () => {
    limiter.acquire('u1', 2);
    limiter.acquire('u1', 2);
    expect(() => limiter.acquire('u1', 2)).toThrowError(PythonToolError);
  });

  it('caps are per-user, not global', () => {
    limiter.acquire('u1', 1);
    limiter.acquire('u2', 1);
    expect(() => limiter.acquire('u1', 1)).toThrowError(PythonToolError);
    expect(() => limiter.acquire('u2', 1)).toThrowError(PythonToolError);
  });

  it('release decrements and admits the next caller', () => {
    limiter.acquire('u1', 1);
    expect(() => limiter.acquire('u1', 1)).toThrowError(PythonToolError);
    limiter.release('u1');
    limiter.acquire('u1', 1);
  });

  it('release on missing key is a no-op', () => {
    expect(() => limiter.release('u-never-acquired')).not.toThrow();
  });

  it('error message includes the cap', () => {
    limiter.acquire('u1', 2);
    limiter.acquire('u1', 2);
    try {
      limiter.acquire('u1', 2);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as PythonToolError).message).toMatch(/max concurrent python runs \(2\)/);
    }
  });
});
