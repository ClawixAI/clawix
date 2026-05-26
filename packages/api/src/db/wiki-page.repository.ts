import { Injectable } from '@nestjs/common';

import type { WikiPage, WikiScope, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const RESERVED_SLUGS = new Set(['_schema']);

interface CreateWikiPageData {
  readonly ownerId: string;
  readonly title: string;
  readonly summary: string;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly scope?: WikiScope;
}

interface UpdateWikiPageData {
  readonly title?: string;
  readonly summary?: string;
  readonly content?: string;
  readonly tags?: readonly string[];
  readonly scope?: WikiScope;
}

/**
 * Repository for WikiPage records.
 *
 * Visibility rules for `findVisibleToUser`:
 *  - Owned: pages where ownerId matches the user
 *  - Group-shared: pages shared to a group the user belongs to (not revoked)
 *  - Org-shared: pages shared to the entire org (not revoked)
 */
@Injectable()
export class WikiPageRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new wiki page. Derives a unique slug within the owner's namespace.
   * Tags are normalized to lowercase. The reserved slug "_schema" is rejected.
   */
  async create(data: CreateWikiPageData): Promise<WikiPage> {
    const tags = (data.tags ?? []).map((t) => t.toLowerCase());
    const baseSlug = slugify(data.title);
    if (RESERVED_SLUGS.has(baseSlug)) {
      throw new Error(`Slug "${baseSlug}" is reserved`);
    }
    const slug = await this.uniqueSlug(data.ownerId, baseSlug);
    return this.prisma.wikiPage.create({
      data: {
        ownerId: data.ownerId,
        title: data.title,
        slug,
        summary: data.summary,
        content: data.content,
        tags,
        scope: data.scope ?? 'ARCHIVED',
      },
    });
  }

  /**
   * Create a new wiki page atomically, enforcing the ambient cap inside the
   * same transaction so two concurrent writers can't both pass the cap check.
   *
   * If the desired scope is not AMBIENT, this is equivalent to `create()`.
   * Throws `AMBIENT_CAP_REACHED` (Error with that message) when the cap is hit.
   */
  async createWithAmbientCap(data: CreateWikiPageData, ambientCap: number): Promise<WikiPage> {
    if (data.scope !== 'AMBIENT') return this.create(data);

    const tags = (data.tags ?? []).map((t) => t.toLowerCase());
    const baseSlug = slugify(data.title);
    if (RESERVED_SLUGS.has(baseSlug)) {
      throw new Error(`Slug "${baseSlug}" is reserved`);
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.wikiPage.count({
        where: { ownerId: data.ownerId, scope: 'AMBIENT' },
      });
      if (current >= ambientCap) {
        throw new Error('AMBIENT_CAP_REACHED');
      }
      const slug = await uniqueSlugWithClient(tx, data.ownerId, baseSlug);
      return tx.wikiPage.create({
        data: {
          ownerId: data.ownerId,
          title: data.title,
          slug,
          summary: data.summary,
          content: data.content,
          tags,
          scope: 'AMBIENT',
        },
      });
    });
  }

  /**
   * Promote an existing page to AMBIENT (or downgrade out) atomically. When
   * promoting, enforces `ambientCap` inside the transaction. Returns null if
   * the page does not exist or is not owned by the caller.
   */
  async setScopeWithAmbientCap(
    ownerId: string,
    pageId: string,
    newScope: WikiScope,
    ambientCap: number,
  ): Promise<WikiPage | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.wikiPage.findUnique({ where: { id: pageId } });
      if (!existing || existing.ownerId !== ownerId) return null;
      if (newScope === 'AMBIENT' && existing.scope !== 'AMBIENT') {
        const current = await tx.wikiPage.count({
          where: { ownerId, scope: 'AMBIENT' },
        });
        if (current >= ambientCap) {
          throw new Error('AMBIENT_CAP_REACHED');
        }
      }
      return tx.wikiPage.update({ where: { id: pageId }, data: { scope: newScope } });
    });
  }

  /**
   * Update a wiki page, guarded by ownership. Returns null if the page does
   * not exist or the caller is not the owner.
   */
  async updateByOwner(
    ownerId: string,
    pageId: string,
    data: UpdateWikiPageData,
  ): Promise<WikiPage | null> {
    const existing = await this.prisma.wikiPage.findUnique({ where: { id: pageId } });
    if (!existing || existing.ownerId !== ownerId) return null;

    const update: Prisma.WikiPageUpdateInput = {};
    if (data.title !== undefined && data.title !== existing.title) {
      const baseSlug = slugify(data.title);
      if (RESERVED_SLUGS.has(baseSlug)) throw new Error(`Slug "${baseSlug}" is reserved`);
      update.title = data.title;
      update.slug = await this.uniqueSlug(ownerId, baseSlug, pageId);
    } else if (data.title !== undefined) {
      update.title = data.title;
    }
    if (data.summary !== undefined) update.summary = data.summary;
    if (data.content !== undefined) update.content = data.content;
    if (data.tags !== undefined) update.tags = data.tags.map((t) => t.toLowerCase());
    if (data.scope !== undefined) update.scope = data.scope;

    return this.prisma.wikiPage.update({ where: { id: pageId }, data: update });
  }

  /**
   * Delete a wiki page, guarded by ownership. Returns false if the page does
   * not exist or the caller is not the owner.
   */
  async deleteByOwner(ownerId: string, pageId: string): Promise<boolean> {
    const existing = await this.prisma.wikiPage.findUnique({ where: { id: pageId } });
    if (!existing || existing.ownerId !== ownerId) return false;
    await this.prisma.wikiPage.delete({ where: { id: pageId } });
    return true;
  }

  /** Find a wiki page by its primary key. Returns null if not found. */
  async findById(pageId: string): Promise<WikiPage | null> {
    return this.prisma.wikiPage.findUnique({ where: { id: pageId } });
  }

  /**
   * Batch fetch wiki pages by id. Missing ids are silently dropped. Used by
   * the backlinks endpoint to avoid an N+1 lookup. The order of the returned
   * array is unspecified.
   */
  async findManyByIds(pageIds: readonly string[]): Promise<readonly WikiPage[]> {
    if (pageIds.length === 0) return [];
    return this.prisma.wikiPage.findMany({ where: { id: { in: [...pageIds] } } });
  }

  /**
   * Find a wiki page by owner + slug. The slug is unique within the owner's
   * namespace; different owners may have identical slugs.
   */
  async findBySlug(ownerId: string, slug: string): Promise<WikiPage | null> {
    return this.prisma.wikiPage.findUnique({ where: { ownerId_slug: { ownerId, slug } } });
  }

  /**
   * Find all wiki pages visible to the given user, ordered by most recent first.
   *
   * Visibility = owned ∪ group-shared (not revoked) ∪ org-shared (not revoked).
   */
  async findVisibleToUser(
    userId: string,
    opts?: { tags?: readonly string[]; scope?: WikiScope; limit?: number },
  ): Promise<readonly WikiPage[]> {
    const where = await this.buildVisibilityWhere(userId);

    if (opts?.tags?.length) {
      where.tags = { hasEvery: opts.tags.map((t) => t.toLowerCase()) };
    }
    if (opts?.scope) {
      where.scope = opts.scope;
    }

    return this.prisma.wikiPage.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: opts?.limit ?? 200,
    });
  }

  /**
   * Fetch a single page only if it is visible to the user. Returns null on
   * both "not found" and "not visible" (callers can't distinguish — they
   * shouldn't, leaking that distinction is a small info-disclosure issue).
   *
   * Prefer this over `findVisibleToUser` + array-search: O(1) lookup with the
   * same predicate, and it does not have a row-limit ceiling.
   */
  async findVisibleByIdToUser(userId: string, pageId: string): Promise<WikiPage | null> {
    const where = await this.buildVisibilityWhere(userId);
    return this.prisma.wikiPage.findFirst({ where: { AND: [{ id: pageId }, where] } });
  }

  private async buildVisibilityWhere(userId: string): Promise<Prisma.WikiPageWhereInput> {
    const groupRows = await this.prisma.groupMember.findMany({
      where: { userId },
      select: { groupId: true },
    });
    const groupIds = groupRows.map((r) => r.groupId);

    return {
      OR: [
        { ownerId: userId },
        {
          shares: {
            some: {
              targetType: 'GROUP',
              groupId: { in: groupIds },
              isRevoked: false,
            },
          },
        },
        {
          shares: {
            some: {
              targetType: 'ORG',
              isRevoked: false,
            },
          },
        },
      ],
    };
  }

  /** List all wiki pages owned by the user, optionally filtered by tags/scope. */
  async listOwnedByUser(
    ownerId: string,
    opts?: { tags?: readonly string[]; scope?: WikiScope; limit?: number },
  ): Promise<readonly WikiPage[]> {
    const where: Prisma.WikiPageWhereInput = { ownerId };
    if (opts?.tags?.length) {
      where.tags = { hasEvery: opts.tags.map((t) => t.toLowerCase()) };
    }
    if (opts?.scope) {
      where.scope = opts.scope;
    }
    return this.prisma.wikiPage.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: opts?.limit ?? 200,
    });
  }

  /** Count pages with scope=AMBIENT owned by the user. */
  async countAmbientOwnedBy(ownerId: string): Promise<number> {
    return this.prisma.wikiPage.count({ where: { ownerId, scope: 'AMBIENT' } });
  }

  /** Count all pages owned by the user regardless of scope. */
  async countOwnedBy(ownerId: string): Promise<number> {
    return this.prisma.wikiPage.count({ where: { ownerId } });
  }

  /**
   * Find daily note wiki pages for the last N days, owned by the user.
   * Daily notes carry tags of the form `daily:YYYY-MM-DD`.
   */
  async findDailyNotes(ownerId: string, daysBack: number): Promise<readonly WikiPage[]> {
    const dates: string[] = [];
    const today = new Date();
    for (let i = 0; i < daysBack; i++) {
      const d = new Date(today);
      d.setUTCDate(today.getUTCDate() - i);
      dates.push(`daily:${d.toISOString().slice(0, 10)}`);
    }
    return this.prisma.wikiPage.findMany({
      where: { ownerId, tags: { hasSome: dates } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Return all distinct tags across wiki pages visible to the user, excluding
   * `daily:*` tags, sorted alphabetically.
   *
   * Pulls only the `tags` column (not full rows). The internal page limit is
   * generous (10k) because tag aggregation has no natural top-N; users with
   * more pages than that should run a server-side aggregation instead.
   */
  async findDistinctTagsVisibleToUser(userId: string): Promise<readonly string[]> {
    const where = await this.buildVisibilityWhere(userId);
    const rows = await this.prisma.wikiPage.findMany({
      where,
      select: { tags: true },
      take: 10000,
    });
    const set = new Set<string>();
    for (const r of rows) {
      for (const t of r.tags) {
        if (!t.startsWith('daily:')) set.add(t);
      }
    }
    return [...set].sort();
  }

  /**
   * Find a unique slug for the given owner + base slug. Appends -2, -3, …
   * until an available candidate is found. Optionally excludes a page id
   * (for renames that keep the same slug).
   */
  private async uniqueSlug(ownerId: string, base: string, excludePageId?: string): Promise<string> {
    return uniqueSlugWithClient(this.prisma, ownerId, base, excludePageId);
  }
}

/**
 * Slug-uniqueness helper that accepts either a PrismaService or an interactive
 * transaction client. Extracted so it can run inside `$transaction` callbacks
 * where the repository's `this.prisma` would skip the open transaction.
 */
async function uniqueSlugWithClient(
  client: { wikiPage: { findFirst: (args: object) => Promise<{ id: string } | null> } },
  ownerId: string,
  base: string,
  excludePageId?: string,
): Promise<string> {
  let candidate = base;
  let n = 1;
  while (true) {
    const conflict = await client.wikiPage.findFirst({
      where: {
        ownerId,
        slug: candidate,
        ...(excludePageId ? { NOT: { id: excludePageId } } : {}),
      },
      select: { id: true },
    });
    if (!conflict) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

/**
 * Convert a page title into a URL-safe slug.
 *
 * - Strips diacritics via NFKD decomposition
 * - Removes non-alphanumeric characters (preserving hyphens and underscores)
 * - Collapses whitespace to hyphens
 * - Lowercases, deduplicates hyphens, and trims to 80 characters
 * - Falls back to "untitled" for empty results
 */
export function slugify(title: string): string {
  const ascii = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics (NFKD output)
    .replace(/[^a-zA-Z0-9_\-\s]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
  if (ascii.length === 0) return 'untitled';
  return ascii;
}
