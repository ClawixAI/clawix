import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';

export interface SessionSearchOptions {
  readonly userId: string;
  readonly query: string;
  readonly days?: number; // optional recency floor; omit = all history
  readonly limit: number;
}

export interface SessionMessageHit {
  readonly sessionId: string;
  readonly messageId: string;
  readonly snippet: string;
  readonly score: number;
  readonly createdAt: Date;
}

/** Full-text weight. */
const ALPHA = 1.0;
/** Trigram similarity weight. */
const BETA = 0.5;

/**
 * Raw-SQL hybrid search over conversational SessionMessage rows
 * (role IN ('user','assistant')). Mirrors WikiSearchRepository: $queryRawUnsafe
 * with positional params, plainto_tsquery/ts_rank_cd, similarity(), ts_headline.
 *
 * The WHERE `@@ … OR … %` clause is required so the partial GIN indexes are
 * used (SessionMessage is large). Searches active AND archived messages.
 *
 * Param slots: $1 = query, $2 = userId, $3 = sinceISO|null, $4 = limit.
 */
@Injectable()
export class SessionMessageSearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  async search(opts: SessionSearchOptions): Promise<SessionMessageHit[]> {
    const since =
      opts.days !== undefined && opts.days > 0
        ? new Date(Date.now() - opts.days * 86_400_000).toISOString()
        : null;

    const params: unknown[] = [opts.query, opts.userId, since, opts.limit];

    const sql = `
      SELECT
        m."sessionId"  AS "sessionId",
        m.id           AS "messageId",
        m."createdAt"  AS "createdAt",
        ts_headline(
          'simple',
          m.content,
          plainto_tsquery('simple', $1),
          'MaxFragments=1, MaxWords=30, MinWords=10'
        ) AS snippet,
        (
            ${ALPHA} * ts_rank_cd(to_tsvector('simple', m.content), plainto_tsquery('simple', $1))
          + ${BETA}  * similarity(m.content, $1)
        ) AS score
      FROM "SessionMessage" m
      JOIN "Session" s ON s.id = m."sessionId"
      WHERE s."userId" = $2::text
        AND m.role IN ('user', 'assistant')
        AND (
              to_tsvector('simple', m.content) @@ plainto_tsquery('simple', $1)
           OR m.content % $1
            )
        AND ($3::timestamptz IS NULL OR m."createdAt" >= $3::timestamptz)
      ORDER BY score DESC, m."createdAt" DESC
      LIMIT $4::int
    `;

    const rows = await this.prisma.$queryRawUnsafe<
      {
        sessionId: string;
        messageId: string;
        createdAt: Date;
        snippet: string;
        score: number;
      }[]
    >(sql, ...params);

    return rows.map((r) => ({
      sessionId: r.sessionId,
      messageId: r.messageId,
      snippet: r.snippet,
      score: Number(r.score),
      createdAt: r.createdAt,
    }));
  }
}
