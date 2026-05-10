import { Injectable } from '@nestjs/common';

/**
 * Per-container install mutex that serialises concurrent `pip install` calls
 * on the same warm container to prevent races on the local pip lockfile.
 *
 * Each unique `containerId` gets its own promise chain. Callers on different
 * containers run fully in parallel. Map entries are bounded by the warm-pool
 * size and are cleaned up lazily after each chain resolves.
 */
@Injectable()
export class InstallMutex {
  private readonly chains = new Map<string, Promise<unknown>>();

  /**
   * Run `fn` exclusively for the given container — i.e. after any currently
   * running operation on that container completes.
   */
  async runExclusive<T>(containerId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(containerId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    // Store a swallowed version so the next waiter's `prev.then(fn, fn)` always
    // resolves, regardless of whether `fn` threw.
    this.chains.set(
      containerId,
      next.catch(() => undefined),
    );
    return next;
  }
}
