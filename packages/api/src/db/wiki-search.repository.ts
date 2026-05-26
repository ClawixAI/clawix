import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';

export interface SearchOptions {
  readonly userId: string;
  readonly query: string;
  readonly tags?: readonly string[];
  readonly ownership: 'mine' | 'visible';
  readonly limit: number;
}

export interface WikiSearchHit {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly snippet: string;
  readonly tags: string[];
  readonly score: number;
  readonly isOwned: boolean;
  readonly updatedAt: Date;
}

/** Hybrid ranking weights. */
const ALPHA = 1.0; // full-text ts_rank_cd weight
const BETA = 0.5; // trigram content similarity weight
const GAMMA = 2.0; // trigram title similarity weight (title match counts more)
const DELTA = 0.2; // recency decay weight (30-day half-life-ish)

/**
 * Repository for full-text + fuzzy wiki page search.
 *
 * Uses raw SQL to leverage pg_trgm (GIN index) and tsvector/tsquery (FTS).
 *
 * Parameter binding strategy: parameters are allocated sequentially as they
 * are referenced in the SQL, so the placeholder numbers match the params array
 * exactly. This is required by pg — it enforces that the declared parameter
 * count equals the number of values supplied.
 *
 * Param slots:
 *   $1 = userId  (always)
 *   $2 = query   (always)
 *   $3 = limit   (always)
 *   $4 = tags[]  (only when tag filter is active — shifts subsequent params)
 *   $N = groupIds[] (only for ownership='visible')
 */
@Injectable()
export class WikiSearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  async search(opts: SearchOptions): Promise<WikiSearchHit[]> {
    const tagsLower = (opts.tags ?? []).map((t) => t.toLowerCase());

    const groupRows = await this.prisma.groupMember.findMany({
      where: { userId: opts.userId },
      select: { groupId: true },
    });
    const groupIds = groupRows.map((r) => r.groupId);

    // Build params and SQL fragments in lockstep so placeholder numbers always
    // match the params array length.
    const params: unknown[] = [
      opts.userId, // $1
      opts.query, // $2
      opts.limit, // $3
    ];

    // Tag filter: $4 (optional)
    const tagClause = tagsLower.length
      ? (() => {
          params.push(tagsLower); // $4
          return `AND wp.tags @> $${params.length}::text[]`;
        })()
      : '';

    // Visibility clause: for 'visible' we need groupIds as an extra param.
    const visibilityClause = buildVisibilityClause(opts.ownership, groupIds, params);

    const sql = `
      SELECT
        wp.id,
        wp.slug,
        wp.title,
        wp.summary,
        wp.tags,
        wp."updatedAt",
        wp."ownerId",
        ts_headline(
          'simple',
          wp.content,
          plainto_tsquery('simple', $2),
          'MaxFragments=1, MaxWords=20, MinWords=8'
        ) AS snippet,
        (
            ${ALPHA} * ts_rank_cd(
              to_tsvector('simple',
                coalesce(wp.title, '')   || ' ' ||
                coalesce(wp.summary, '') || ' ' ||
                coalesce(wp.content, '')),
              plainto_tsquery('simple', $2)
            )
          + ${BETA}  * similarity(wp.content, $2)
          + ${GAMMA} * similarity(wp.title,   $2)
          + ${DELTA} * (
              1.0 / (
                1.0 + EXTRACT(EPOCH FROM (NOW() - wp."updatedAt")) / 86400.0 / 30.0
              )
            )
        ) AS score
      FROM "WikiPage" wp
      WHERE ${visibilityClause}
        ${tagClause}
      ORDER BY score DESC
      LIMIT $3::int
    `;

    const rows = await this.prisma.$queryRawUnsafe<
      {
        id: string;
        slug: string;
        title: string;
        summary: string;
        tags: string[];
        updatedAt: Date;
        ownerId: string;
        snippet: string;
        score: number;
      }[]
    >(sql, ...params);

    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      summary: r.summary,
      snippet: r.snippet,
      tags: r.tags,
      score: Number(r.score),
      isOwned: r.ownerId === opts.userId,
      updatedAt: r.updatedAt,
    }));
  }
}

/**
 * Build the visibility WHERE clause and append any needed params to the array.
 *
 * 'mine'    → only the owner check; no extra params needed.
 * 'visible' → owner OR WikiShare (group or org); appends groupIds as the next
 *             param slot.
 */
function buildVisibilityClause(
  ownership: 'mine' | 'visible',
  groupIds: string[],
  params: unknown[],
): string {
  if (ownership === 'mine') {
    return `wp."ownerId" = $1::text`;
  }
  // 'visible': append groupIds as the next parameter.
  params.push(groupIds);
  const pn = params.length; // placeholder number for groupIds
  return `(
    wp."ownerId" = $1::text
    OR EXISTS (
      SELECT 1 FROM "WikiShare" s
       WHERE s."pageId" = wp."id"
         AND s."isRevoked" = false
         AND (
               (s."targetType" = 'GROUP' AND s."groupId" = ANY($${pn}::text[]))
            OR  s."targetType" = 'ORG'
             )
    )
  )`;
}
