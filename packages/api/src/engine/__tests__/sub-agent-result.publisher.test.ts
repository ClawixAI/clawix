import { describe, it, expect, beforeEach, vi } from 'vitest';

import { SubAgentResultPublisher } from '../sub-agent-result.publisher.js';
import { KEY_PREFIXES, PUBSUB_CHANNELS } from '../../cache/cache.constants.js';
import type { AgentRunRepository } from '../../db/agent-run.repository.js';
import type { AgentDefinitionRepository } from '../../db/agent-definition.repository.js';
import type { RedisService } from '../../cache/redis.service.js';
import type { RedisPubSubService } from '../../cache/redis-pubsub.service.js';

describe('SubAgentResultPublisher', () => {
  let mockAgentRunRepo: { findById: ReturnType<typeof vi.fn> };
  let mockAgentDefRepo: { findById: ReturnType<typeof vi.fn> };
  let mockRedis: {
    lpush: ReturnType<typeof vi.fn>;
    expire: ReturnType<typeof vi.fn>;
  };
  let mockPubsub: { publish: ReturnType<typeof vi.fn> };
  let publisher: SubAgentResultPublisher;

  const childRun = {
    id: 'run-child',
    parentAgentRunId: 'run-parent',
    agentDefinitionId: 'def-1',
  };
  const parentRun = { id: 'run-parent', sessionId: 'sess-parent' };
  const outcome = { status: 'completed' as const, output: 'done', error: null };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentRunRepo = {
      findById: vi
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(id === 'run-child' ? childRun : parentRun),
        ),
    };
    mockAgentDefRepo = { findById: vi.fn().mockResolvedValue({ name: 'researcher' }) };
    mockRedis = {
      lpush: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(true),
    };
    mockPubsub = { publish: vi.fn().mockResolvedValue(1) };

    publisher = new SubAgentResultPublisher(
      mockAgentRunRepo as unknown as AgentRunRepository,
      mockAgentDefRepo as unknown as AgentDefinitionRepository,
      mockRedis as unknown as RedisService,
      mockPubsub as unknown as RedisPubSubService,
    );
  });

  it('publishes on the happy path: one lpush + TTLs + wake-up', async () => {
    await publisher.publishOutcome('run-child', outcome);

    expect(mockRedis.lpush).toHaveBeenCalledTimes(1);
    const [key, raw] = mockRedis.lpush.mock.calls[0]!;
    expect(key).toBe(`${KEY_PREFIXES.agentResults}sess-parent`);
    expect(JSON.parse(raw as string)).toMatchObject({
      agentRunId: 'run-child',
      status: 'completed',
      output: 'done',
    });
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      PUBSUB_CHANNELS.agentResultReady,
      'sess-parent',
    );
  });

  it('retries a failed enqueue with backoff and succeeds without duplicating the item', async () => {
    vi.useFakeTimers();
    try {
      mockRedis.lpush
        .mockRejectedValueOnce(new Error('redis blip'))
        .mockRejectedValueOnce(new Error('redis blip'))
        .mockResolvedValueOnce(1);

      const pending = publisher.publishOutcome('run-child', outcome);
      await vi.runAllTimersAsync();
      await pending;

      // Exactly three attempts, one eventual success — never a 4th push.
      expect(mockRedis.lpush).toHaveBeenCalledTimes(3);
      expect(mockPubsub.publish).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('dead-letters with the full payload after exhausting attempts, never throws', async () => {
    vi.useFakeTimers();
    try {
      mockRedis.lpush.mockRejectedValue(new Error('redis down'));

      const pending = publisher.publishOutcome('run-child', outcome);
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toBeUndefined();

      expect(mockRedis.lpush).toHaveBeenCalledTimes(3);
      // Nothing enqueued → no TTL refresh, no wake-up.
      expect(mockRedis.expire).not.toHaveBeenCalled();
      expect(mockPubsub.publish).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a post-enqueue wake-up failure does not retry the lpush (no duplicate item)', async () => {
    mockPubsub.publish.mockRejectedValue(new Error('pubsub down'));

    await expect(publisher.publishOutcome('run-child', outcome)).resolves.toBeUndefined();

    expect(mockRedis.lpush).toHaveBeenCalledTimes(1);
  });

  it('no-ops for primary runs (no parentAgentRunId)', async () => {
    mockAgentRunRepo.findById.mockResolvedValue({ id: 'run-x', parentAgentRunId: null });

    await publisher.publishOutcome('run-x', outcome);

    expect(mockRedis.lpush).not.toHaveBeenCalled();
  });
});
