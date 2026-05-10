import { describe, it, expect } from 'vitest';
import {
  BrowserSessionSemaphore,
  BrowserQuotaExhaustedError,
} from './browser-session-semaphore.js';

describe('BrowserSessionSemaphore', () => {
  it('allows up to maxConcurrent acquires for a key', async () => {
    const sem = new BrowserSessionSemaphore({ getQuota: () => 2, queueTimeoutMs: 50 });

    await sem.acquire('user-1');
    await sem.acquire('user-1');

    expect(sem.activeCount('user-1')).toBe(2);
  });

  it('queues and resolves when a slot frees up', async () => {
    const sem = new BrowserSessionSemaphore({ getQuota: () => 1, queueTimeoutMs: 1000 });

    await sem.acquire('user-1');
    const pending = sem.acquire('user-1');

    let resolved = false;
    pending.then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(false);

    sem.release('user-1');
    await pending;
    expect(resolved).toBe(true);
  });

  it('throws BrowserQuotaExhaustedError on queue timeout', async () => {
    const sem = new BrowserSessionSemaphore({ getQuota: () => 1, queueTimeoutMs: 30 });

    await sem.acquire('user-1');
    await expect(sem.acquire('user-1')).rejects.toBeInstanceOf(BrowserQuotaExhaustedError);
  });

  it('keys are independent across users', async () => {
    const sem = new BrowserSessionSemaphore({ getQuota: () => 1, queueTimeoutMs: 50 });

    await sem.acquire('user-1');
    await sem.acquire('user-2');

    expect(sem.activeCount('user-1')).toBe(1);
    expect(sem.activeCount('user-2')).toBe(1);
  });
});
