/**
 * Memory tools — save_memory and search_memory for agent use.
 *
 * - save_memory: create or update a user's personal memory items
 * - search_memory: search visible memories by text query and/or tags
 */
import { createLogger } from '@clawix/shared';

import type { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { MemoryItemRepository } from '../../db/memory-item.repository.js';
import { extractText } from '../memory-utils.js';
import type { Tool, ToolResult } from '../tool.js';
import type { ToolRegistry } from '../tool-registry.js';

const logger = createLogger('engine:tools:memory');

// ------------------------------------------------------------------ //
//  Helpers                                                            //
// ------------------------------------------------------------------ //

function ok(output: string): ToolResult {
  return { output, isError: false };
}

function err(output: string): ToolResult {
  return { output, isError: true };
}

// ------------------------------------------------------------------ //
//  Validation constants                                               //
// ------------------------------------------------------------------ //

const MAX_CONTENT_LENGTH = 2000;
const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 50;

// ------------------------------------------------------------------ //
//  save_memory                                                        //
// ------------------------------------------------------------------ //

/**
 * Creates a save_memory tool bound to a PrismaService instance and user.
 *
 * The tool validates content length, tag count/length, and policy quotas
 * before creating or updating a MemoryItem.
 */
export function createSaveMemoryTool(prisma: PrismaService, userId: string): Tool {
  return {
    name: 'save_memory',
    description:
      'Save or update a personal memory item. Provide content (text) and optional tags. ' +
      'To update an existing memory, provide its memoryId.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          description:
            'Content to store. Can be a string or a JSON object/array (max 2000 chars when serialized).',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for categorization (max 10 tags, each max 50 chars).',
        },
        memoryId: {
          type: 'string',
          description: 'If provided, update this existing memory instead of creating a new one.',
        },
      },
      required: ['content'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const content = params['content'];
      const tags = (params['tags'] as string[] | undefined) ?? [];
      const memoryId = params['memoryId'] as string | undefined;

      // --- Null/undefined guard ---
      if (content === undefined || content === null) {
        return err('Content is required.');
      }

      // --- Validation ---
      const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
      if (contentStr.length > MAX_CONTENT_LENGTH) {
        return err('Content too long (max 2000 characters when serialized).');
      }

      if (tags.length > MAX_TAGS || tags.some((t) => t.length > MAX_TAG_LENGTH)) {
        return err('Too many tags (max 10) or tag too long (max 50 chars).');
      }

      // --- Update path ---
      if (memoryId) {
        const existing = (await prisma.memoryItem.findUnique({
          where: { id: memoryId },
        })) as { readonly id: string; readonly ownerId: string } | null;

        if (!existing) {
          return err('Memory item not found.');
        }

        if (existing.ownerId !== userId) {
          return err('You can only update your own memories.');
        }

        const updated = (await prisma.memoryItem.update({
          where: { id: memoryId },
          data: { content: content as Prisma.InputJsonValue, tags },
        })) as { readonly id: string };

        logger.info({ memoryId: updated.id, userId }, 'Memory item updated');
        return ok(JSON.stringify({ memoryId: updated.id, action: 'updated' }));
      }

      // --- Create path: check policy quota ---
      const user = (await prisma.user.findUnique({
        where: { id: userId },
        include: { policy: true },
      })) as { readonly policy: { readonly maxMemoryItems: number } } | null;

      const maxItems = user?.policy.maxMemoryItems ?? 1000;
      const currentCount = await prisma.memoryItem.count({ where: { ownerId: userId } });

      if (currentCount >= maxItems) {
        return err('Memory limit reached for your policy.');
      }

      const created = (await prisma.memoryItem.create({
        data: {
          ownerId: userId,
          content: content as Prisma.InputJsonValue,
          tags,
        },
      })) as { readonly id: string };

      logger.info({ memoryId: created.id, userId }, 'Memory item created');
      return ok(JSON.stringify({ memoryId: created.id, action: 'created' }));
    },
  };
}

// ------------------------------------------------------------------ //
//  search_memory                                                      //
// ------------------------------------------------------------------ //

/**
 * Creates a search_memory tool bound to a MemoryItemRepository and user.
 *
 * Searches visible memories (owned, group-shared, org-shared) by text
 * query and/or tags.
 */
export function createSearchMemoryTool(memoryItemRepo: MemoryItemRepository, userId: string): Tool {
  return {
    name: 'search_memory',
    description:
      'Search your memories and shared memories by text query and/or tags. ' +
      'Returns matching memory items with content, tags, and ownership info.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for in memory content.' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags (all specified tags must be present).',
        },
      },
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const query = params['query'] as string | undefined;
      const tags = params['tags'] as string[] | undefined;

      if (!query && (!tags || tags.length === 0)) {
        return err('At least one of query or tags must be provided.');
      }

      const items = await memoryItemRepo.search(userId, {
        query,
        tags,
        maxResults: 20,
      });

      if (items.length === 0) {
        return ok('No memories found matching your query.');
      }

      const results = items.map((item) => {
        const record = item as {
          readonly id: string;
          readonly ownerId: string;
          readonly content: unknown;
          readonly tags: readonly string[];
          readonly createdAt: Date;
        };
        return {
          memoryId: record.id,
          content: extractText(record.content),
          tags: record.tags,
          createdAt: record.createdAt.toISOString(),
          isOwned: record.ownerId === userId,
        };
      });

      logger.info({ userId, resultCount: results.length }, 'Memory search completed');
      return ok(JSON.stringify({ results }));
    },
  };
}

// ------------------------------------------------------------------ //
//  list_groups                                                        //
// ------------------------------------------------------------------ //

/**
 * Creates a list_groups tool bound to a PrismaService instance and user.
 *
 * Returns the user's group memberships plus a synthetic "org" entry,
 * so the agent can enumerate valid share targets.
 */
export function createListGroupsTool(prisma: PrismaService, userId: string): Tool {
  return {
    name: 'list_groups',
    description:
      'List the groups you belong to and the organization. Use this before share_memory to see available targets.',
    parameters: { type: 'object', properties: {} },

    async execute(): Promise<ToolResult> {
      const memberships = await prisma.groupMember.findMany({
        where: { userId },
        include: { group: true },
      });

      const groups: { groupId: string; name: string; type: 'group' | 'org'; role: string }[] =
        memberships.map((m: { groupId: string; role: string; group: { name: string } }) => ({
          groupId: m.groupId,
          name: m.group.name,
          type: 'group' as const,
          role: m.role,
        }));

      groups.push({ groupId: 'org', name: 'Organization', type: 'org', role: 'member' });

      logger.debug({ userId, groupCount: groups.length - 1 }, 'Listed groups');
      return ok(JSON.stringify(groups));
    },
  };
}

// ------------------------------------------------------------------ //
//  share_memory                                                       //
// ------------------------------------------------------------------ //

/**
 * Creates a share_memory tool bound to a PrismaService instance and user.
 *
 * Shares a user-owned memory item with a group or the whole organization.
 * Includes ownership validation, group membership checks, idempotency,
 * and audit logging.
 */
export function createShareMemoryTool(prisma: PrismaService, userId: string): Tool {
  return {
    name: 'share_memory',
    description:
      'Share one of your private memories with a group or the whole organization. ' +
      'Only use this when the user explicitly asks to share.',
    parameters: {
      type: 'object',
      properties: {
        memoryId: { type: 'string', description: 'The ID of the memory to share.' },
        targetType: {
          type: 'string',
          enum: ['group', 'org'],
          description: 'Share to a group or the whole organization.',
        },
        groupId: { type: 'string', description: 'Required when targetType is group.' },
      },
      required: ['memoryId', 'targetType'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const memoryId = params['memoryId'] as string;
      const targetType = params['targetType'] as string;
      const groupId = params['groupId'] as string | undefined;

      // --- Conditional validation ---
      if (targetType === 'group' && !groupId) {
        return err('groupId is required when sharing to a group.');
      }

      // --- Ownership check ---
      const item = (await prisma.memoryItem.findUnique({ where: { id: memoryId } })) as {
        readonly id: string;
        readonly ownerId: string;
      } | null;

      if (!item) {
        return err('Memory item not found.');
      }

      if (item.ownerId !== userId) {
        return err('You can only share your own memories.');
      }

      // --- Group membership check ---
      if (targetType === 'group') {
        const membership = await prisma.groupMember.findFirst({
          where: { userId, groupId },
        });
        if (!membership) {
          return err('Group not found or you are not a member.');
        }
      }

      // --- Idempotency: check for existing non-revoked share ---
      const dbTargetType = targetType === 'group' ? 'GROUP' : 'ORG';
      const existingShare = (await prisma.memoryShare.findFirst({
        where: {
          memoryItemId: memoryId,
          targetType: dbTargetType,
          ...(targetType === 'group' ? { groupId } : {}),
          isRevoked: false,
        },
      })) as { readonly id: string } | null;

      if (existingShare) {
        logger.debug({ memoryId, targetType, shareId: existingShare.id }, 'Idempotent share');
        return ok(
          JSON.stringify({
            shareId: existingShare.id,
            targetType,
            ...(groupId ? { groupId } : {}),
          }),
        );
      }

      // --- Create share ---
      const share = (await prisma.memoryShare.create({
        data: {
          memoryItemId: memoryId,
          sharedBy: userId,
          targetType: dbTargetType,
          ...(targetType === 'group' ? { groupId } : {}),
        },
      })) as { readonly id: string };

      // --- Audit log ---
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'memory.share',
          resource: 'MemoryItem',
          resourceId: memoryId,
          details: { targetType, groupId: groupId ?? null, shareId: share.id },
        },
      });

      logger.info({ memoryId, userId, targetType, shareId: share.id }, 'Memory shared');
      return ok(
        JSON.stringify({
          shareId: share.id,
          targetType,
          ...(groupId ? { groupId } : {}),
        }),
      );
    },
  };
}

// ------------------------------------------------------------------ //
//  registerMemoryTools                                                //
// ------------------------------------------------------------------ //

/**
 * Register all memory tools into the given registry.
 */
export function registerMemoryTools(
  registry: ToolRegistry,
  prisma: PrismaService,
  memoryItemRepo: MemoryItemRepository,
  userId: string,
): void {
  registry.register(createSaveMemoryTool(prisma, userId));
  registry.register(createSearchMemoryTool(memoryItemRepo, userId));
  registry.register(createListGroupsTool(prisma, userId));
  registry.register(createShareMemoryTool(prisma, userId));
}
