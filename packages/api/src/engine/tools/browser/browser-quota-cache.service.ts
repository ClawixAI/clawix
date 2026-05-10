/**
 * BrowserQuotaCache — lightweight stale-while-revalidate cache that resolves
 * per-user browser concurrency quotas from the Policy table. The semaphore's
 * `getQuota` callback is synchronous, so the cache is warmed once at the
 * start of an agent run and kept available for the run's lifetime.
 *
 * Semantics:
 *   - **Cold** (never warmed): `read()` returns 0 — fail-safe; `warm()` must
 *     run before any browser tool. The agent runner does this at run start.
 *   - **Fresh** (warmed within `TTL_MS`): returns the cached quota.
 *   - **Stale** (TTL expired): returns the last-known quota AND triggers a
 *     background refresh so future reads pick up policy changes. This avoids
 *     a 30-second timeout when a long-running agent uses browser tools more
 *     than `TTL_MS` after the run started — see review issue #4.
 */

import { Injectable } from '@nestjs/common';
import { createLogger } from '@clawix/shared';

import { UserRepository } from '../../../db/user.repository.js';
import { PolicyRepository } from '../../../db/policy.repository.js';

const logger = createLogger('engine:tools:browser:quota-cache');

const TTL_MS = 60_000;

interface CacheEntry {
  quota: number;
  expires: number;
}

@Injectable()
export class BrowserQuotaCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlightRefresh = new Map<string, Promise<void>>();

  constructor(
    private readonly users: UserRepository,
    private readonly policies: PolicyRepository,
  ) {}

  /**
   * Synchronous read. Returns 0 only when the entry is cold (never warmed).
   * Stale entries return their last-known quota and schedule a background
   * refresh so the next call sees up-to-date policy values.
   */
  read(userId: string): number {
    const entry = this.cache.get(userId);
    if (!entry) return 0;
    if (entry.expires < Date.now()) {
      this.scheduleRefresh(userId);
    }
    return entry.quota;
  }

  /**
   * Trigger a background refresh, deduplicating concurrent requests so a
   * burst of stale reads results in a single DB round-trip.
   */
  private scheduleRefresh(userId: string): void {
    if (this.inFlightRefresh.has(userId)) return;
    const promise = this.warm(userId)
      .catch((err: unknown) => {
        logger.warn(
          { userId, err: err instanceof Error ? err.message : String(err) },
          'BrowserQuotaCache background refresh failed; serving last-known quota',
        );
      })
      .finally(() => {
        this.inFlightRefresh.delete(userId);
      });
    this.inFlightRefresh.set(userId, promise);
  }

  /**
   * Populate (or refresh) the cache entry for `userId` by loading the user's
   * policy from the database.
   *
   * - DB exceptions (connection failures, query errors) propagate to the caller
   *   so they surface as a run-start failure rather than a silent quota-zero.
   * - If the user or policy row is not found (null return), logs a warning and
   *   returns without caching — read() will return 0 (no slots).
   */
  async warm(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) {
      logger.warn({ userId }, 'BrowserQuotaCache.warm: user not found');
      return;
    }

    const policy = await this.policies.findById(user.policyId);
    if (!policy) {
      logger.warn({ userId, policyId: user.policyId }, 'BrowserQuotaCache.warm: policy not found');
      return;
    }

    this.cache.set(userId, {
      quota: policy.maxConcurrentBrowserSessions,
      expires: Date.now() + TTL_MS,
    });
  }
}
