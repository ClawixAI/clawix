import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import { WikiPageRepository } from '../db/wiki-page.repository.js';
import { WikiLinkRepository } from '../db/wiki-link.repository.js';
import { WikiShareRepository } from '../db/wiki-share.repository.js';
import { AuditLogRepository } from '../db/audit-log.repository.js';
import { PolicyRepository } from '../db/policy.repository.js';
import { UserRepository } from '../db/user.repository.js';
import { loadSchemaTemplate } from '../engine/wiki/schema-template.js';
import {
  runLintChecks,
  ALL_CHECKS,
  type LintCheck,
  type LintFinding,
} from '../engine/wiki/lint.js';

import type { WikiScope, WikiPage, Policy, User } from '../generated/prisma/client.js';
import type {
  CreateWikiPageInput,
  UpdateWikiPageInput,
  WikiShareTarget,
  WikiGraph,
  WikiGraphNode,
} from '@clawix/shared';

export interface WikiPageDto {
  id: string;
  slug: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  scope: WikiScope;
  isOrgShared: boolean;
  sharedGroupIds: string[];
  isOwned: boolean;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class WikiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pages: WikiPageRepository,
    private readonly links: WikiLinkRepository,
    private readonly shares: WikiShareRepository,
    private readonly audit: AuditLogRepository,
    private readonly policies: PolicyRepository,
    private readonly users: UserRepository,
  ) {}

  async listPages(
    userId: string,
    q: {
      ownership: 'mine' | 'visible';
      tags?: string[];
      scope?: WikiScope;
      query?: string;
    },
  ): Promise<WikiPageDto[]> {
    const rows =
      q.ownership === 'mine'
        ? await this.pages.listOwnedByUser(userId, {
            tags: q.tags,
            scope: q.scope,
            limit: 500,
          })
        : await this.pages.findVisibleToUser(userId, {
            tags: q.tags,
            scope: q.scope,
            limit: 500,
          });

    const nonSchema = rows.filter((p) => p.slug !== '_schema' && !p.tags.includes('kind:schema'));

    const filtered = q.query
      ? nonSchema.filter(
          (p) =>
            p.title.toLowerCase().includes(q.query!.toLowerCase()) ||
            p.summary.toLowerCase().includes(q.query!.toLowerCase()),
        )
      : nonSchema;

    const orgIds = new Set(await this.shares.findPageIdsWithOrgShare(filtered.map((p) => p.id)));

    return filtered.map((p) => this.toDto(userId, p, orgIds.has(p.id), []));
  }

  async getPage(userId: string, pageId: string): Promise<WikiPageDto> {
    const page = await this.pages.findVisibleByIdToUser(userId, pageId);
    if (!page) throw new NotFoundException('Page not found');
    const orgIds = new Set(await this.shares.findPageIdsWithOrgShare([page.id]));
    const sharedGroupIds = await this.findSharedGroupIds(page.id);
    return this.toDto(userId, page, orgIds.has(page.id), sharedGroupIds);
  }

  async createPage(userId: string, input: CreateWikiPageInput): Promise<WikiPageDto> {
    if (!input.summary || input.summary.trim().length === 0) {
      throw new BadRequestException('summary required');
    }

    const policy = await this.lookupPolicy(userId);
    const maxWikiPages = policy?.maxWikiPages ?? 1000;
    const total = await this.pages.countOwnedBy(userId);
    if (total >= maxWikiPages) {
      throw new BadRequestException(`Max wiki pages reached (${maxWikiPages})`);
    }

    const ambientCap = policy?.maxAmbientPages ?? 5;
    let page;
    try {
      page = await this.pages.createWithAmbientCap(
        {
          ownerId: userId,
          title: input.title,
          summary: input.summary,
          content: input.content,
          tags: input.tags ?? [],
          scope: input.scope,
        },
        ambientCap,
      );
    } catch (err) {
      if (err instanceof Error && err.message === 'AMBIENT_CAP_REACHED') {
        throw new BadRequestException(`Ambient cap reached (${ambientCap}). Unpin a page first.`);
      }
      throw err;
    }

    await this.links.rebuildForPage(page.id, userId, input.content);

    await this.audit.create({
      userId,
      action: 'wiki.create',
      resource: 'wiki_page',
      resourceId: page.id,
      details: { slug: page.slug, title: page.title, scope: page.scope },
    });

    return this.toDto(userId, page, false, []);
  }

  async updatePage(
    userId: string,
    pageId: string,
    input: UpdateWikiPageInput,
  ): Promise<WikiPageDto> {
    const existing = await this.pages.findById(pageId);
    if (!existing || existing.ownerId !== userId) throw new ForbiddenException();

    if (existing.slug === '_schema') {
      throw new BadRequestException('Use updateSchema for the schema page');
    }

    // Promote-to-AMBIENT goes through the atomic repository helper. Other
    // updates use the standard non-transactional path; the cap check is only
    // load-bearing on the transition.
    if (input.scope === 'AMBIENT' && existing.scope !== 'AMBIENT') {
      const policy = await this.lookupPolicy(userId);
      const ambientCap = policy?.maxAmbientPages ?? 5;
      try {
        await this.pages.setScopeWithAmbientCap(userId, pageId, 'AMBIENT', ambientCap);
      } catch (err) {
        if (err instanceof Error && err.message === 'AMBIENT_CAP_REACHED') {
          throw new BadRequestException(`Ambient cap reached (${ambientCap}). Unpin a page first.`);
        }
        throw err;
      }
    }

    const updated = await this.pages.updateByOwner(userId, pageId, input);
    if (!updated) throw new NotFoundException();

    if (input.content !== undefined) {
      await this.links.rebuildForPage(updated.id, userId, input.content);
    }

    const fieldsChanged = Object.keys(input).filter((k) => k !== 'pageId');
    await this.audit.create({
      userId,
      action: 'wiki.update',
      resource: 'wiki_page',
      resourceId: updated.id,
      details: { slug: updated.slug, fieldsChanged },
    });

    if (input.scope !== undefined && existing.scope !== input.scope) {
      await this.audit.create({
        userId,
        action: 'wiki.scope_change',
        resource: 'wiki_page',
        resourceId: updated.id,
        details: { from: existing.scope, to: input.scope },
      });
    }

    const orgIds = new Set(await this.shares.findPageIdsWithOrgShare([updated.id]));
    const sharedGroupIds = await this.findSharedGroupIds(updated.id);
    return this.toDto(userId, updated, orgIds.has(updated.id), sharedGroupIds);
  }

  async deletePage(userId: string, pageId: string): Promise<void> {
    const page = await this.pages.findById(pageId);
    if (!page || page.ownerId !== userId) throw new ForbiddenException();

    if (page.slug === '_schema') {
      throw new BadRequestException('Cannot delete the schema page');
    }

    await this.pages.deleteByOwner(userId, pageId);

    await this.audit.create({
      userId,
      action: 'wiki.delete',
      resource: 'wiki_page',
      resourceId: pageId,
      details: { slug: page.slug, title: page.title },
    });
  }

  async sharePage(
    userId: string,
    pageId: string,
    target: WikiShareTarget,
  ): Promise<{ shareId: string }> {
    const page = await this.pages.findById(pageId);
    if (!page || page.ownerId !== userId) throw new ForbiddenException();

    if (target.targetType === 'org') {
      const me: User | null = await this.users.findById(userId);
      if (me?.role !== 'admin') {
        throw new ForbiddenException('Org sharing requires admin role');
      }
      const share = await this.shares.setOrgShare(pageId, userId);
      await this.audit.create({
        userId,
        action: 'wiki.share',
        resource: 'wiki_page',
        resourceId: pageId,
        details: { shareId: share.id, targetType: 'ORG' },
      });
      return { shareId: share.id };
    }

    const isMember = await this.prisma.groupMember.findFirst({
      where: { userId, groupId: target.groupId },
    });
    if (!isMember) throw new ForbiddenException('Not a group member');

    const share = await this.shares.setGroupShare(pageId, target.groupId, userId);
    await this.audit.create({
      userId,
      action: 'wiki.share',
      resource: 'wiki_page',
      resourceId: pageId,
      details: { shareId: share.id, targetType: 'GROUP', groupId: target.groupId },
    });
    return { shareId: share.id };
  }

  async revokeOrgShare(userId: string, pageId: string): Promise<void> {
    const page = await this.pages.findById(pageId);
    if (!page || page.ownerId !== userId) throw new ForbiddenException();
    const active = await this.prisma.wikiShare.findFirst({
      where: { pageId, targetType: 'ORG', isRevoked: false },
    });
    if (!active) throw new BadRequestException('No active org share to revoke');
    const ok = await this.shares.revokeShareById(active.id);
    if (!ok) throw new BadRequestException('Already revoked');
    await this.audit.create({
      userId,
      action: 'wiki.unshare',
      resource: 'wiki_page',
      resourceId: pageId,
      details: { shareId: active.id, targetType: 'ORG' },
    });
  }

  async revokeShare(userId: string, shareId: string): Promise<void> {
    const share = await this.prisma.wikiShare.findUnique({ where: { id: shareId } });
    if (!share) throw new NotFoundException();

    const page = await this.pages.findById(share.pageId);
    if (!page || page.ownerId !== userId) throw new ForbiddenException();

    const ok = await this.shares.revokeShareById(shareId);
    if (!ok) throw new BadRequestException('Share already revoked');

    await this.audit.create({
      userId,
      action: 'wiki.unshare',
      resource: 'wiki_page',
      resourceId: page.id,
      details: { shareId, targetType: share.targetType, groupId: share.groupId },
    });
  }

  async listBacklinks(
    userId: string,
    pageId: string,
  ): Promise<{ id: string; slug: string; title: string; summary: string }[]> {
    // Visibility check
    await this.getPage(userId, pageId);

    const back = await this.links.findBacklinks(pageId);
    if (back.length === 0) return [];
    const sources = await this.pages.findManyByIds(back.map((b) => b.fromPageId));
    return sources.map((p) => ({ id: p.id, slug: p.slug, title: p.title, summary: p.summary }));
  }

  async getGraph(userId: string, q: { ownership: 'mine' | 'visible' }): Promise<WikiGraph> {
    const rows =
      q.ownership === 'mine'
        ? await this.pages.listOwnedByUser(userId, { limit: 5000 })
        : await this.pages.findVisibleToUser(userId, { limit: 5000 });

    const visible = rows.filter((p) => p.slug !== '_schema' && !p.tags.includes('kind:schema'));
    const idSet = visible.map((p) => p.id);
    const [orgIds, edgeRows] = await Promise.all([
      this.shares.findPageIdsWithOrgShare(idSet),
      this.links.findEdgesAmongPages(idSet),
    ]);
    const orgSet = new Set(orgIds);

    const nodes: WikiGraphNode[] = visible.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      summary: p.summary,
      domain: extractDomain(p.tags),
      isDaily: p.tags.some((t) => t.startsWith('daily:')),
      scope: p.scope,
      isOwned: p.ownerId === userId,
      isOrgShared: orgSet.has(p.id),
    }));

    const edges = edgeRows.map((e) => ({ from: e.fromPageId, to: e.toPageId }));
    return { nodes, edges };
  }

  async getSchema(userId: string): Promise<{ content: string }> {
    await this.bootstrapSchemaPage(userId);
    const schema = (await this.pages.findBySlug(userId, '_schema'))!;
    return { content: schema.content };
  }

  async updateSchema(userId: string, content: string): Promise<void> {
    await this.bootstrapSchemaPage(userId);
    const schema = (await this.pages.findBySlug(userId, '_schema'))!;
    await this.prisma.wikiPage.update({ where: { id: schema.id }, data: { content } });
    await this.audit.create({
      userId,
      action: 'wiki.schema_update',
      resource: 'wiki_page',
      resourceId: schema.id,
      details: { summary: 'user edited their _schema page' },
    });
  }

  async runLint(userId: string, checks?: LintCheck[], maxResults = 20): Promise<LintFinding[]> {
    const policy = await this.lookupPolicy(userId);
    const lintEnabled = policy?.wikiLintEnabled ?? true;
    if (!lintEnabled) throw new ForbiddenException('Lint disabled for your policy');

    const checksToRun: readonly LintCheck[] = checks?.length
      ? checks.filter((c) => (ALL_CHECKS as readonly string[]).includes(c))
      : ALL_CHECKS;

    const findings = await runLintChecks(
      this.pages,
      this.links,
      userId,
      checksToRun,
      Math.min(Math.max(maxResults, 1), 100),
    );

    await this.audit.create({
      userId,
      action: 'wiki.lint',
      resource: 'wiki_page',
      resourceId: 'lint-run',
      details: { checks: [...checksToRun], findingsCount: findings.length },
    });

    return findings;
  }

  async bootstrapSchemaPage(userId: string): Promise<void> {
    const existing = await this.pages.findBySlug(userId, '_schema');
    if (existing) return;

    const tpl = await loadSchemaTemplate();
    await this.prisma.wikiPage.create({
      data: {
        ownerId: userId,
        title: 'Wiki Schema',
        slug: '_schema',
        summary: 'How this wiki is organized — read me on every session.',
        content: tpl,
        tags: ['kind:schema'],
        scope: 'AMBIENT',
      },
    });
  }

  private async lookupPolicy(userId: string): Promise<Policy | null> {
    try {
      const user: User | null = await this.users.findById(userId);
      if (!user) return null;
      return await this.policies.findById(user.policyId);
    } catch {
      return null;
    }
  }

  private toDto(
    userId: string,
    p: WikiPage,
    isOrgShared: boolean,
    sharedGroupIds: readonly string[],
  ): WikiPageDto {
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      summary: p.summary,
      content: p.content,
      tags: p.tags,
      scope: p.scope,
      isOrgShared,
      sharedGroupIds: [...sharedGroupIds],
      isOwned: p.ownerId === userId,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private async findSharedGroupIds(pageId: string): Promise<readonly string[]> {
    const active = await this.shares.findActiveSharesForPage(pageId);
    return active
      .filter((s) => s.targetType === 'GROUP' && s.groupId !== null)
      .map((s) => s.groupId!);
  }

  async revokeGroupShare(userId: string, pageId: string, groupId: string): Promise<void> {
    const page = await this.pages.findById(pageId);
    if (!page || page.ownerId !== userId) throw new ForbiddenException();
    const active = await this.prisma.wikiShare.findFirst({
      where: { pageId, targetType: 'GROUP', groupId, isRevoked: false },
    });
    if (!active) throw new BadRequestException('No active group share to revoke');
    const ok = await this.shares.revokeShareById(active.id);
    if (!ok) throw new BadRequestException('Already revoked');
    await this.audit.create({
      userId,
      action: 'wiki.unshare',
      resource: 'wiki_page',
      resourceId: pageId,
      details: { shareId: active.id, targetType: 'GROUP', groupId },
    });
  }
}

function extractDomain(tags: readonly string[]): string | null {
  const t = tags.find((x) => x.startsWith('domain:'));
  return t ? t.slice('domain:'.length) : null;
}
