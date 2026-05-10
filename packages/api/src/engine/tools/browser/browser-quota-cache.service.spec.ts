import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// vi.hoisted ensures the spy is created before the vi.mock factory runs.
const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));

vi.mock('@clawix/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clawix/shared')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: mockWarn,
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

import { BrowserQuotaCache } from './browser-quota-cache.service.js';
import type { UserRepository } from '../../../db/user.repository.js';
import type { PolicyRepository } from '../../../db/policy.repository.js';

const makeUser = (policyId = 'policy-1') =>
  ({
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test',
    passwordHash: 'x',
    policyId,
    role: 'member' as const,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as Awaited<ReturnType<UserRepository['findById']>>;

const makePolicy = (maxConcurrentBrowserSessions = 3) =>
  ({
    id: 'policy-1',
    name: 'default',
    description: null,
    maxTokenBudget: null,
    maxAgents: 5,
    maxSkills: 50,
    maxMemoryItems: 100,
    maxGroupsOwned: 3,
    allowedProviders: ['anthropic'],
    features: {},
    cronEnabled: false,
    maxScheduledTasks: 5,
    minCronIntervalSecs: 300,
    maxTokensPerCronRun: null,
    allowBrowserCdp: false,
    maxConcurrentBrowserSessions,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as Awaited<ReturnType<PolicyRepository['findById']>>;

function buildDeps(overrides?: {
  userFindById?: ReturnType<typeof vi.fn>;
  policyFindById?: ReturnType<typeof vi.fn>;
}) {
  const userFindById = overrides?.userFindById ?? vi.fn().mockResolvedValue(makeUser());
  const policyFindById = overrides?.policyFindById ?? vi.fn().mockResolvedValue(makePolicy());

  const users = { findById: userFindById } as unknown as UserRepository;
  const policies = { findById: policyFindById } as unknown as PolicyRepository;

  return { users, policies };
}

describe('BrowserQuotaCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockWarn.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 0 when cache is cold (not yet warmed)', () => {
    const { users, policies } = buildDeps();
    const cache = new BrowserQuotaCache(users, policies);

    expect(cache.read('user-1')).toBe(0);
  });

  it('returns the policy quota after warm()', async () => {
    const { users, policies } = buildDeps();
    const cache = new BrowserQuotaCache(users, policies);

    await cache.warm('user-1');

    expect(cache.read('user-1')).toBe(3);
  });

  it('returns last-known quota after TTL expires (stale-while-revalidate)', async () => {
    const { users, policies } = buildDeps();
    const cache = new BrowserQuotaCache(users, policies);

    await cache.warm('user-1');
    expect(cache.read('user-1')).toBe(3);

    // Advance past the 60 s TTL — read should still serve the stale value
    // rather than dropping to 0 and forcing a 30-second semaphore timeout.
    vi.advanceTimersByTime(61_000);

    expect(cache.read('user-1')).toBe(3);
  });

  it('triggers a background refresh on stale read so subsequent reads pick up policy changes', async () => {
    const policyFindById = vi
      .fn()
      .mockResolvedValueOnce(makePolicy(3))
      .mockResolvedValueOnce(makePolicy(7));
    const { users, policies } = buildDeps({ policyFindById });
    const cache = new BrowserQuotaCache(users, policies);

    await cache.warm('user-1');
    expect(cache.read('user-1')).toBe(3);

    vi.advanceTimersByTime(61_000);

    // First stale read serves last-known value; behind it a refresh fires.
    expect(cache.read('user-1')).toBe(3);

    // Let the background refresh resolve.
    await vi.runAllTimersAsync();

    expect(cache.read('user-1')).toBe(7);
    expect(policyFindById).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent background refreshes', async () => {
    const policyFindById = vi.fn().mockResolvedValue(makePolicy(3));
    const { users, policies } = buildDeps({ policyFindById });
    const cache = new BrowserQuotaCache(users, policies);

    await cache.warm('user-1');
    vi.advanceTimersByTime(61_000);

    // Three rapid stale reads should produce only one extra DB hit.
    cache.read('user-1');
    cache.read('user-1');
    cache.read('user-1');

    await vi.runAllTimersAsync();

    // 1 from warm() + 1 from the deduplicated refresh = 2.
    expect(policyFindById).toHaveBeenCalledTimes(2);
  });

  it('logs a warning and returns when user is not found (null)', async () => {
    const { users, policies } = buildDeps({
      userFindById: vi.fn().mockResolvedValue(null),
    });
    const cache = new BrowserQuotaCache(users, policies);

    await expect(cache.warm('missing-user')).resolves.toBeUndefined();
    expect(cache.read('missing-user')).toBe(0);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'missing-user' }),
      expect.stringContaining('user not found'),
    );
  });

  it('logs a warning and returns when policy is not found (null)', async () => {
    const { users, policies } = buildDeps({
      policyFindById: vi.fn().mockResolvedValue(null),
    });
    const cache = new BrowserQuotaCache(users, policies);

    await expect(cache.warm('user-1')).resolves.toBeUndefined();
    expect(cache.read('user-1')).toBe(0);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.stringContaining('policy not found'),
    );
  });

  it('propagates DB exceptions from user lookup (does not swallow)', async () => {
    const { users, policies } = buildDeps({
      userFindById: vi.fn().mockRejectedValue(new Error('DB connection lost')),
    });
    const cache = new BrowserQuotaCache(users, policies);

    await expect(cache.warm('user-1')).rejects.toThrow(/DB connection lost/);
  });

  it('propagates DB exceptions from policy lookup (does not swallow)', async () => {
    const { users, policies } = buildDeps({
      policyFindById: vi.fn().mockRejectedValue(new Error('DB connection lost')),
    });
    const cache = new BrowserQuotaCache(users, policies);

    await expect(cache.warm('user-1')).rejects.toThrow(/DB connection lost/);
  });

  it('refreshes the entry on re-warm before TTL expires', async () => {
    const policyFindById = vi
      .fn()
      .mockResolvedValueOnce(makePolicy(3))
      .mockResolvedValueOnce(makePolicy(5));
    const { users, policies } = buildDeps({ policyFindById });
    const cache = new BrowserQuotaCache(users, policies);

    await cache.warm('user-1');
    expect(cache.read('user-1')).toBe(3);

    await cache.warm('user-1');
    expect(cache.read('user-1')).toBe(5);
  });
});
