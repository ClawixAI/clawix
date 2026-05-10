import { Injectable } from '@nestjs/common';

export class BrowserQuotaExhaustedError extends Error {
  constructor(
    public readonly key: string,
    public readonly quota: number,
  ) {
    super(`browser quota exhausted (${quota} concurrent allowed); retry shortly`);
    this.name = 'BrowserQuotaExhaustedError';
  }
}

interface PerKeyState {
  active: number;
  waiters: (() => void)[];
}

export interface BrowserSessionSemaphoreOptions {
  /** Resolve current quota for the key (e.g., user → policy.maxConcurrent...). */
  getQuota: (key: string) => number;
  queueTimeoutMs: number;
}

@Injectable()
export class BrowserSessionSemaphore {
  private readonly state = new Map<string, PerKeyState>();

  constructor(private readonly opts: BrowserSessionSemaphoreOptions) {}

  activeCount(key: string): number {
    return this.state.get(key)?.active ?? 0;
  }

  async acquire(key: string): Promise<void> {
    const quota = Math.max(0, this.opts.getQuota(key));
    const s = this.state.get(key) ?? { active: 0, waiters: [] };
    this.state.set(key, s);

    if (s.active < quota) {
      s.active++;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const onSlot = (): void => {
        clearTimeout(timer);
        s.active++;
        resolve();
      };
      const timer = setTimeout(() => {
        const idx = s.waiters.indexOf(onSlot);
        if (idx >= 0) s.waiters.splice(idx, 1);
        reject(new BrowserQuotaExhaustedError(key, quota));
      }, this.opts.queueTimeoutMs);
      s.waiters.push(onSlot);
    });
  }

  release(key: string): void {
    const s = this.state.get(key);
    if (!s) return;
    s.active = Math.max(0, s.active - 1);
    const next = s.waiters.shift();
    if (next) next();
  }
}
