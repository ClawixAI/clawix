import { Injectable } from '@nestjs/common';

import { SessionMessageSearchRepository } from '../../db/session-message-search.repository.js';
import { SessionRepository } from '../../db/session.repository.js';
import type { RecallSessionInfo } from '../../db/session.repository.js';
import { deriveSessionTitle } from './session-title.js';
import { relativeDay } from './relative-day.js';
import type { RecentSessionLine } from './render-recent-sessions.js';

export interface SessionSearchResult {
  readonly sessionId: string;
  readonly title: string;
  /** Relative date of the matching message (not the session start). */
  readonly relativeDate: string;
  readonly date: string; // YYYY-MM-DD of the matching message
  readonly snippet: string;
}

@Injectable()
export class SessionSearchService {
  constructor(
    private readonly searchRepo: SessionMessageSearchRepository,
    private readonly sessionRepo: SessionRepository,
  ) {}

  /** Search the user's past conversations; label each hit with a title/date. */
  async search(
    opts: { userId: string; query: string; days?: number; limit: number },
    now: Date = new Date(),
  ): Promise<SessionSearchResult[]> {
    const hits = await this.searchRepo.search({
      userId: opts.userId,
      query: opts.query,
      limit: opts.limit,
      // Omit the key entirely when unset (≠ passing days: undefined).
      ...(opts.days !== undefined && { days: opts.days }),
    });
    if (hits.length === 0) return [];

    const ids = [...new Set(hits.map((h) => h.sessionId))];
    const titleData = await this.sessionRepo.findRecallTitleData(ids);
    const byId = new Map<string, RecallSessionInfo>(titleData.map((t) => [t.id, t]));

    return hits.map((h) => {
      const info = byId.get(h.sessionId);
      const title = info
        ? deriveSessionTitle({
            storedTopic: info.topic,
            firstUserMessages: info.firstUserMessages,
            createdAt: info.createdAt,
          })
        : `Session — ${h.createdAt.toISOString().slice(0, 10)}`;
      return {
        sessionId: h.sessionId,
        title,
        relativeDate: relativeDay(h.createdAt, now),
        date: h.createdAt.toISOString().slice(0, 10),
        snippet: h.snippet,
      };
    });
  }

  /** Title + createdAt lines for the most-recent sessions (Recent Sessions block). */
  async recentSessions(opts: {
    userId: string;
    limit: number;
    excludeSessionId?: string;
  }): Promise<RecentSessionLine[]> {
    const rows = await this.sessionRepo.findRecentForRecall(
      opts.userId,
      opts.limit,
      opts.excludeSessionId,
    );
    return rows.map((r) => ({
      title: deriveSessionTitle({
        storedTopic: r.topic,
        firstUserMessages: r.firstUserMessages,
        createdAt: r.createdAt,
      }),
      createdAt: r.createdAt,
    }));
  }
}
