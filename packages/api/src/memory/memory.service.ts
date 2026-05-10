import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateMemoryItemInput, MemoryListScope, UpdateMemoryItemInput } from '@clawix/shared';
import { createLogger } from '@clawix/shared';

import type { MemoryItem } from '../generated/prisma/client.js';
import { MemoryItemRepository } from '../db/memory-item.repository.js';
import { AuditLogRepository } from '../db/audit-log.repository.js';
import { SessionRepository } from '../db/session.repository.js';

const logger = createLogger('memory-service');

export type MemoryItemWithOrgShare = MemoryItem & { readonly isOrgShared: boolean };

/**
 * Custom-memory service. Enforces tagging conventions, ownership for write
 * operations, audit-logs every transition, and reconciles `MemoryShare(ORG)`
 * rows when items are shared org-wide.
 *
 * Org-share is the original Phase-1 mechanism (a `MemoryShare(targetType=ORG)`
 * row). The dashboard editor's "Share with org" toggle calls into this service
 * with `orgShared: true|false`; the service writes/revokes the row.
 *
 * Visibility rules in `MemoryItemRepository.findVisibleToUser` already cover
 * org-shared items via the existing `MemoryShare(ORG, !isRevoked)` branch —
 * so once the row is in place every other user's `search_memory` agent tool
 * sees the item automatically.
 */
@Injectable()
export class MemoryService {
  constructor(
    private readonly repo: MemoryItemRepository,
    private readonly auditRepo: AuditLogRepository,
    private readonly sessionRepo: SessionRepository,
  ) {}

  /**
   * Annotate each item with whether it has an active org-share row.
   * Single batch query — N+1-safe.
   */
  private async enrichWithOrgShare(
    items: readonly MemoryItem[],
  ): Promise<readonly MemoryItemWithOrgShare[]> {
    if (items.length === 0) return [];
    const sharedIds = new Set(await this.repo.findItemIdsWithOrgShare(items.map((i) => i.id)));
    return items.map((i) => ({ ...i, isOrgShared: sharedIds.has(i.id) }));
  }

  /**
   * Drop cached system prompts on every active session so the next turn
   * rebuilds the tag-index with the freshly mutated memory in scope.
   * Without this, an agent session created before the mutation keeps a
   * stale tag list and may not realize a new memory item is queryable.
   */
  private async invalidatePromptCache(): Promise<void> {
    try {
      await this.sessionRepo.clearAllCachedSystemPrompts();
    } catch (err) {
      logger.warn({ err }, 'Failed to clear cached system prompts after memory mutation');
    }
  }

  async list(userId: string, scope: MemoryListScope): Promise<readonly MemoryItemWithOrgShare[]> {
    const items =
      scope === 'mine'
        ? await this.repo.listOwnedByUser(userId)
        : await this.repo.findVisibleToUser(userId);
    return this.enrichWithOrgShare(items);
  }

  async read(id: string, userId: string): Promise<MemoryItemWithOrgShare> {
    const item = await this.repo.findById(id);
    if (!item) throw new NotFoundException();

    if (item.ownerId !== userId) {
      // Defense-in-depth: 404 if the item isn't in the caller's visible set.
      const visible = await this.repo.findVisibleToUser(userId);
      if (!visible.some((v) => v.id === id)) throw new NotFoundException();
    }
    const [enriched] = await this.enrichWithOrgShare([item]);
    return enriched!;
  }

  async create(
    userId: string,
    callerRole: string,
    input: CreateMemoryItemInput,
  ): Promise<MemoryItemWithOrgShare> {
    const tags = input.tags ?? [];
    this.assertTagRules(tags);

    // Org-sharing is admin-only. Matches Phase-1 plan: only an admin can
    // opt content into org-wide visibility via MemoryShare(targetType=ORG).
    if (input.orgShared === true && callerRole !== 'admin') {
      throw new ForbiddenException('Only admins can share memory with the organization');
    }

    const item = await this.repo.create({ ownerId: userId, content: input.content, tags });

    await this.auditRepo.create({
      userId,
      action: 'memory.create',
      resource: 'MemoryItem',
      resourceId: item.id,
      details: { tags: [...tags] },
    });

    if (input.orgShared === true) {
      await this.repo.setOrgShare(item.id, userId);
      await this.auditRepo.create({
        userId,
        action: 'memory.org_share',
        resource: 'MemoryItem',
        resourceId: item.id,
        details: {},
      });
    }

    await this.invalidatePromptCache();
    return { ...item, isOrgShared: input.orgShared === true };
  }

  async update(
    id: string,
    userId: string,
    callerRole: string,
    input: UpdateMemoryItemInput,
  ): Promise<MemoryItemWithOrgShare> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException();
    if (existing.ownerId !== userId) {
      throw new ForbiddenException('Only the owner can update this memory');
    }

    if (input.tags !== undefined) {
      this.assertTagRules(input.tags);
    }

    // Adding org-share is admin-only. Removing it is owner-only (the owner can
    // always un-share their own memory; admin role is only required to flip ON).
    if (input.orgShared === true && callerRole !== 'admin') {
      const alreadyShared = await this.isOrgShared(id);
      if (!alreadyShared) {
        throw new ForbiddenException('Only admins can share memory with the organization');
      }
    }

    // content/tags update first (only fields the repo supports)
    const repoPatch: { content?: unknown; tags?: readonly string[] } = {};
    if (input.content !== undefined) repoPatch.content = input.content;
    if (input.tags !== undefined) repoPatch.tags = input.tags;
    const updated =
      Object.keys(repoPatch).length > 0 ? await this.repo.update(id, repoPatch) : existing;

    await this.auditRepo.create({
      userId,
      action: 'memory.update',
      resource: 'MemoryItem',
      resourceId: id,
      details: input.tags !== undefined ? { tags: [...input.tags] } : {},
    });

    // Reconcile MemoryShare(ORG) row if orgShared was set in the patch.
    if (input.orgShared !== undefined) {
      const wasShared = await this.isOrgShared(id);
      if (input.orgShared && !wasShared) {
        await this.repo.setOrgShare(id, userId);
        await this.auditRepo.create({
          userId,
          action: 'memory.org_share',
          resource: 'MemoryItem',
          resourceId: id,
          details: {},
        });
      } else if (!input.orgShared && wasShared) {
        await this.repo.revokeOrgShare(id);
        await this.auditRepo.create({
          userId,
          action: 'memory.org_unshare',
          resource: 'MemoryItem',
          resourceId: id,
          details: {},
        });
      }
    }

    await this.invalidatePromptCache();
    const [enriched] = await this.enrichWithOrgShare([updated]);
    return enriched!;
  }

  private async isOrgShared(memoryItemId: string): Promise<boolean> {
    const matches = await this.repo.findItemIdsWithOrgShare([memoryItemId]);
    return matches.length > 0;
  }

  async delete(id: string, userId: string): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException();
    if (existing.ownerId !== userId) {
      throw new ForbiddenException('Only the owner can delete this memory');
    }

    await this.repo.delete(id);

    await this.auditRepo.create({
      userId,
      action: 'memory.delete',
      resource: 'MemoryItem',
      resourceId: id,
      details: { tags: [...existing.tags] },
    });

    await this.invalidatePromptCache();
  }

  /**
   * Enforce the custom-memory tagging conventions:
   *  - exactly one `domain:<x>` tag (kanban column membership)
   *  - no `daily:` tags (those belong to the daily-notes agent flow)
   */
  private assertTagRules(tags: readonly string[]): void {
    const domainTags = tags.filter((t) => t.startsWith('domain:'));
    if (domainTags.length === 0) {
      throw new BadRequestException("Exactly one 'domain:<x>' tag is required");
    }
    if (domainTags.length > 1) {
      throw new BadRequestException("Only one 'domain:<x>' tag is allowed");
    }
    if (tags.some((t) => t.startsWith('daily:'))) {
      throw new BadRequestException(
        "'daily:' tags are managed by the agent's save_memory flow and not allowed here",
      );
    }
  }
}
