import { describe, it, expect, vi } from 'vitest';
import { SessionSearchService } from '../session-search.service.js';
import type { SessionMessageSearchRepository } from '../../../db/session-message-search.repository.js';
import type { SessionRepository } from '../../../db/session.repository.js';

const now = new Date('2026-05-26T12:00:00.000Z');

function makeService(over: { hits?: unknown[]; titleData?: unknown[]; recent?: unknown[] }) {
  const searchRepo = {
    search: vi.fn().mockResolvedValue(over.hits ?? []),
  } as unknown as SessionMessageSearchRepository;
  const sessionRepo = {
    findRecallTitleData: vi.fn().mockResolvedValue(over.titleData ?? []),
    findRecentForRecall: vi.fn().mockResolvedValue(over.recent ?? []),
  } as unknown as SessionRepository;
  return { service: new SessionSearchService(searchRepo, sessionRepo), searchRepo, sessionRepo };
}

describe('SessionSearchService', () => {
  it('labels search hits with derived session titles + relative dates', async () => {
    const { service, searchRepo } = makeService({
      hits: [
        {
          sessionId: 's1',
          messageId: 'm1',
          snippet: '…the wiki redesign…',
          score: 1.2,
          createdAt: new Date('2026-05-24T00:00:00.000Z'),
        },
      ],
      titleData: [
        {
          id: 's1',
          topic: null,
          createdAt: new Date('2026-05-24T00:00:00.000Z'),
          firstUserMessages: ['hi', 'help me redesign the wiki'],
        },
      ],
    });

    const results = await service.search({ userId: 'u1', query: 'wiki', limit: 8 }, now);

    expect(searchRepo.search).toHaveBeenCalledWith({ userId: 'u1', query: 'wiki', limit: 8 });
    expect(results).toEqual([
      {
        sessionId: 's1',
        title: 'help me redesign the wiki',
        relativeDate: '2 days ago',
        date: '2026-05-24',
        snippet: '…the wiki redesign…',
      },
    ]);
  });

  it('returns [] (and skips title lookup) when there are no hits', async () => {
    const { service, sessionRepo } = makeService({ hits: [] });
    const results = await service.search({ userId: 'u1', query: 'x', limit: 8 }, now);
    expect(results).toEqual([]);
    expect(sessionRepo.findRecallTitleData).not.toHaveBeenCalled();
  });

  it('recentSessions returns titled lines newest-first', async () => {
    const { service, sessionRepo } = makeService({
      recent: [
        {
          id: 's2',
          topic: 'Renamed convo',
          createdAt: new Date('2026-05-25T00:00:00.000Z'),
          firstUserMessages: [],
        },
      ],
    });

    const out = await service.recentSessions({ userId: 'u1', limit: 10, excludeSessionId: 'cur' });

    expect(sessionRepo.findRecentForRecall).toHaveBeenCalledWith('u1', 10, 'cur');
    expect(out).toEqual([
      { title: 'Renamed convo', createdAt: new Date('2026-05-25T00:00:00.000Z') },
    ]);
  });
});
