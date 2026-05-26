import { Injectable } from '@nestjs/common';

import type { WikiLink } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { parseWikiLinks } from '../engine/wiki/parse-wiki-links.js';

@Injectable()
export class WikiLinkRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reconcile WikiLink rows so that `fromPageId` links to exactly the set of
   * pages referenced by `[[slug]]` markers in `content`. Unresolved slugs (no
   * matching page in the same owner namespace) are silently ignored.
   */
  async rebuildForPage(fromPageId: string, ownerId: string, content: string): Promise<void> {
    const slugs = parseWikiLinks(content);
    const resolved = slugs.length
      ? await this.prisma.wikiPage.findMany({
          where: { ownerId, slug: { in: slugs } },
          select: { id: true },
        })
      : [];
    const toIds = new Set(resolved.map((r) => r.id));

    const existing = await this.prisma.wikiLink.findMany({
      where: { fromPageId },
      select: { id: true, toPageId: true },
    });
    const existingIds = new Set(existing.map((r) => r.toPageId));

    const toAdd = [...toIds].filter((id) => !existingIds.has(id));
    const toRemove = existing.filter((r) => !toIds.has(r.toPageId)).map((r) => r.id);

    await this.prisma.$transaction([
      ...(toRemove.length
        ? [this.prisma.wikiLink.deleteMany({ where: { id: { in: toRemove } } })]
        : []),
      ...toAdd.map((toPageId) => this.prisma.wikiLink.create({ data: { fromPageId, toPageId } })),
    ]);
  }

  async findBacklinks(toPageId: string): Promise<readonly WikiLink[]> {
    return this.prisma.wikiLink.findMany({ where: { toPageId } });
  }

  async findEdgesAmongPages(
    pageIds: readonly string[],
  ): Promise<readonly { fromPageId: string; toPageId: string }[]> {
    if (pageIds.length < 2) return [];
    const rows = await this.prisma.wikiLink.findMany({
      where: {
        fromPageId: { in: [...pageIds] },
        toPageId: { in: [...pageIds] },
      },
      select: { fromPageId: true, toPageId: true },
    });
    return rows;
  }

  async deleteAllForPage(pageId: string): Promise<void> {
    await this.prisma.wikiLink.deleteMany({
      where: { OR: [{ fromPageId: pageId }, { toPageId: pageId }] },
    });
  }
}
