vi.mock('@clawix/shared', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSaveMemoryTool,
  createSearchMemoryTool,
  createListGroupsTool,
  createShareMemoryTool,
} from '../tools/memory.js';
import type { MemoryItemRepository } from '../../db/memory-item.repository.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

// ------------------------------------------------------------------ //
//  Prisma mock helpers                                                //
// ------------------------------------------------------------------ //

function makePrisma(overrides: {
  userFindUnique?: ReturnType<typeof vi.fn>;
  memoryItemCount?: ReturnType<typeof vi.fn>;
  memoryItemCreate?: ReturnType<typeof vi.fn>;
  memoryItemFindUnique?: ReturnType<typeof vi.fn>;
  memoryItemUpdate?: ReturnType<typeof vi.fn>;
}) {
  return {
    user: { findUnique: overrides.userFindUnique ?? vi.fn() },
    memoryItem: {
      count: overrides.memoryItemCount ?? vi.fn(),
      create: overrides.memoryItemCreate ?? vi.fn(),
      findUnique: overrides.memoryItemFindUnique ?? vi.fn(),
      update: overrides.memoryItemUpdate ?? vi.fn(),
    },
  } as never;
}

function makeMemoryRepo(
  searchResult: readonly unknown[] = [],
): Pick<MemoryItemRepository, 'search'> {
  return {
    search: vi.fn().mockResolvedValue(searchResult),
  };
}

// ------------------------------------------------------------------ //
//  Extended Prisma mock for list_groups / share_memory                //
// ------------------------------------------------------------------ //

type MockPrisma = ReturnType<typeof buildMockPrisma>;

function buildMockPrisma() {
  return {
    user: { findUnique: vi.fn() },
    memoryItem: {
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    groupMember: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    memoryShare: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  };
}

// ------------------------------------------------------------------ //
//  save_memory                                                        //
// ------------------------------------------------------------------ //

describe('save_memory tool', () => {
  const userId = 'user-1';

  it('creates a new memory with content and tags', async () => {
    const created = {
      id: 'mem-1',
      ownerId: userId,
      content: { text: 'hello' },
      tags: ['greeting'],
    };
    const prisma = makePrisma({
      userFindUnique: vi.fn().mockResolvedValue({ id: userId, policy: { maxMemoryItems: 100 } }),
      memoryItemCount: vi.fn().mockResolvedValue(5),
      memoryItemCreate: vi.fn().mockResolvedValue(created),
    });

    const tool = createSaveMemoryTool(prisma, userId);
    const result = await tool.execute({ content: 'hello', tags: ['greeting'] });

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.output);
    expect(parsed.memoryId).toBe('mem-1');
    expect(parsed.action).toBe('created');
  });

  it('creates with empty tags when none provided', async () => {
    const created = { id: 'mem-2', ownerId: userId, content: { text: 'no tags' }, tags: [] };
    const prisma = makePrisma({
      userFindUnique: vi.fn().mockResolvedValue({ id: userId, policy: { maxMemoryItems: 100 } }),
      memoryItemCount: vi.fn().mockResolvedValue(0),
      memoryItemCreate: vi.fn().mockResolvedValue(created),
    });

    const tool = createSaveMemoryTool(prisma, userId);
    const result = await tool.execute({ content: 'no tags' });

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.output);
    expect(parsed.memoryId).toBe('mem-2');
    expect(parsed.action).toBe('created');
  });

  it('rejects content over 2000 chars', async () => {
    const prisma = makePrisma({});
    const tool = createSaveMemoryTool(prisma, userId);
    const result = await tool.execute({ content: 'x'.repeat(2001) });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('Content too long');
  });

  it('rejects more than 10 tags', async () => {
    const prisma = makePrisma({});
    const tool = createSaveMemoryTool(prisma, userId);
    const tags = Array.from({ length: 11 }, (_, i) => `tag${i}`);
    const result = await tool.execute({ content: 'hello', tags });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('Too many tags');
  });

  it('rejects tags longer than 50 chars', async () => {
    const prisma = makePrisma({});
    const tool = createSaveMemoryTool(prisma, userId);
    const result = await tool.execute({ content: 'hello', tags: ['a'.repeat(51)] });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('tag too long');
  });

  it('returns error when policy quota reached', async () => {
    const prisma = makePrisma({
      userFindUnique: vi.fn().mockResolvedValue({ id: userId, policy: { maxMemoryItems: 10 } }),
      memoryItemCount: vi.fn().mockResolvedValue(10),
    });

    const tool = createSaveMemoryTool(prisma, userId);
    const result = await tool.execute({ content: 'over limit' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('Memory limit reached');
  });

  it('updates an existing memory owned by user', async () => {
    const existing = { id: 'mem-1', ownerId: userId, content: { text: 'old' }, tags: [] };
    const updated = { ...existing, content: { text: 'new' }, tags: ['updated'] };
    const prisma = makePrisma({
      memoryItemFindUnique: vi.fn().mockResolvedValue(existing),
      memoryItemUpdate: vi.fn().mockResolvedValue(updated),
    });

    const tool = createSaveMemoryTool(prisma, userId);
    const result = await tool.execute({ memoryId: 'mem-1', content: 'new', tags: ['updated'] });

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.output);
    expect(parsed.action).toBe('updated');
  });

  it('rejects update for non-existent memoryId', async () => {
    const prisma = makePrisma({
      memoryItemFindUnique: vi.fn().mockResolvedValue(null),
    });

    const tool = createSaveMemoryTool(prisma, userId);
    const result = await tool.execute({ memoryId: 'non-existent', content: 'hello' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('Memory item not found');
  });

  it('should store object content as-is (not wrapped in { text })', async () => {
    const created = { id: 'mem-obj', ownerId: userId };
    const prisma = makePrisma({
      userFindUnique: vi.fn().mockResolvedValue({ id: userId, policy: { maxMemoryItems: 100 } }),
      memoryItemCount: vi.fn().mockResolvedValue(0),
      memoryItemCreate: vi.fn().mockResolvedValue(created),
    });

    const tool = createSaveMemoryTool(prisma, userId);
    await tool.execute({
      content: { key: 'preferred_language', value: 'TypeScript' },
      tags: ['preference'],
    });

    expect((prisma as unknown as { memoryItem: { create: ReturnType<typeof vi.fn> } }).memoryItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        content: { key: 'preferred_language', value: 'TypeScript' },
      }),
    });
  });

  it('should reject object content that exceeds 2000 chars when serialized', async () => {
    const prisma = makePrisma({});
    const tool = createSaveMemoryTool(prisma, userId);
    const largeObj = { data: 'x'.repeat(2000) };
    const result = await tool.execute({ content: largeObj });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('Content too long');
  });

  it('rejects update for memory owned by another user', async () => {
    const existing = { id: 'mem-1', ownerId: 'other-user', content: { text: 'old' }, tags: [] };
    const prisma = makePrisma({
      memoryItemFindUnique: vi.fn().mockResolvedValue(existing),
    });

    const tool = createSaveMemoryTool(prisma, userId);
    const result = await tool.execute({ memoryId: 'mem-1', content: 'hijack' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('only update your own');
  });
});

// ------------------------------------------------------------------ //
//  search_memory                                                      //
// ------------------------------------------------------------------ //

describe('search_memory tool', () => {
  const userId = 'user-1';

  it('returns formatted results with memoryId, content, tags, createdAt, isOwned', async () => {
    const now = new Date('2026-03-21T00:00:00Z');
    const items = [
      {
        id: 'mem-1',
        ownerId: userId,
        content: { text: 'hello world' },
        tags: ['greet'],
        createdAt: now,
      },
    ];
    const repo = makeMemoryRepo(items);

    const tool = createSearchMemoryTool(repo as MemoryItemRepository, userId);
    const result = await tool.execute({ query: 'hello' });

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.output);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].memoryId).toBe('mem-1');
    expect(parsed.results[0].content).toBe('hello world');
    expect(parsed.results[0].tags).toEqual(['greet']);
    expect(parsed.results[0].createdAt).toBe(now.toISOString());
    expect(parsed.results[0].isOwned).toBe(true);
  });

  it('sets isOwned: false for items owned by other users', async () => {
    const items = [
      {
        id: 'mem-2',
        ownerId: 'other-user',
        content: { text: 'shared' },
        tags: [],
        createdAt: new Date(),
      },
    ];
    const repo = makeMemoryRepo(items);

    const tool = createSearchMemoryTool(repo as MemoryItemRepository, userId);
    const result = await tool.execute({ query: 'shared' });

    const parsed = JSON.parse(result.output);
    expect(parsed.results[0].isOwned).toBe(false);
  });

  it('returns "No memories found" message for empty results', async () => {
    const repo = makeMemoryRepo([]);
    const tool = createSearchMemoryTool(repo as MemoryItemRepository, userId);
    const result = await tool.execute({ query: 'nothing' });

    expect(result.isError).toBe(false);
    expect(result.output).toContain('No memories found');
  });

  it('rejects when neither query nor tags provided', async () => {
    const repo = makeMemoryRepo([]);
    const tool = createSearchMemoryTool(repo as MemoryItemRepository, userId);
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.output).toContain('At least one of query or tags');
  });

  it('passes tags to repository search method correctly', async () => {
    const repo = makeMemoryRepo([]);
    const tool = createSearchMemoryTool(repo as MemoryItemRepository, userId);
    await tool.execute({ tags: ['important', 'work'] });

    expect(repo.search).toHaveBeenCalledWith(userId, {
      query: undefined,
      tags: ['important', 'work'],
      maxResults: 20,
    });
  });
});

// ------------------------------------------------------------------ //
//  list_groups                                                        //
// ------------------------------------------------------------------ //

describe('list_groups tool', () => {
  let mockPrisma: MockPrisma;
  let tool: ReturnType<typeof createListGroupsTool>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = buildMockPrisma();
    tool = createListGroupsTool(mockPrisma as unknown as PrismaService, 'user-1');
  });

  it('returns groups with consistent shape plus org entry', async () => {
    mockPrisma.groupMember.findMany.mockResolvedValue([
      { groupId: 'g-1', role: 'OWNER', group: { id: 'g-1', name: 'Engineering' } },
      { groupId: 'g-2', role: 'MEMBER', group: { id: 'g-2', name: 'Product' } },
    ]);

    const result = await tool.execute({});

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.output);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual({
      groupId: 'g-1',
      name: 'Engineering',
      type: 'group',
      role: 'OWNER',
    });
    expect(parsed[1]).toEqual({ groupId: 'g-2', name: 'Product', type: 'group', role: 'MEMBER' });
    expect(parsed[2]).toEqual({
      groupId: 'org',
      name: 'Organization',
      type: 'org',
      role: 'member',
    });
  });

  it('returns only org entry when user has no groups', async () => {
    mockPrisma.groupMember.findMany.mockResolvedValue([]);

    const result = await tool.execute({});

    const parsed = JSON.parse(result.output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      groupId: 'org',
      name: 'Organization',
      type: 'org',
      role: 'member',
    });
  });
});

// ------------------------------------------------------------------ //
//  share_memory                                                       //
// ------------------------------------------------------------------ //

describe('share_memory tool', () => {
  let mockPrisma: MockPrisma;
  let tool: ReturnType<typeof createShareMemoryTool>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = buildMockPrisma();
    tool = createShareMemoryTool(mockPrisma as unknown as PrismaService, 'user-1');
  });

  it('shares memory to a group', async () => {
    mockPrisma.memoryItem.findUnique.mockResolvedValue({ id: 'mem-1', ownerId: 'user-1' });
    mockPrisma.groupMember.findFirst.mockResolvedValue({ groupId: 'g-1', userId: 'user-1' });
    mockPrisma.memoryShare.findFirst.mockResolvedValue(null);
    mockPrisma.memoryShare.create.mockResolvedValue({ id: 'share-1' });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const result = await tool.execute({ memoryId: 'mem-1', targetType: 'group', groupId: 'g-1' });

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.output);
    expect(parsed.shareId).toBe('share-1');
    expect(parsed.targetType).toBe('group');
    expect(parsed.groupId).toBe('g-1');
  });

  it('shares memory to org', async () => {
    mockPrisma.memoryItem.findUnique.mockResolvedValue({ id: 'mem-1', ownerId: 'user-1' });
    mockPrisma.memoryShare.findFirst.mockResolvedValue(null);
    mockPrisma.memoryShare.create.mockResolvedValue({ id: 'share-2' });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const result = await tool.execute({ memoryId: 'mem-1', targetType: 'org' });

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.output);
    expect(parsed.shareId).toBe('share-2');
    expect(parsed.targetType).toBe('org');
  });

  it('returns existing shareId for idempotent share', async () => {
    mockPrisma.memoryItem.findUnique.mockResolvedValue({ id: 'mem-1', ownerId: 'user-1' });
    mockPrisma.memoryShare.findFirst.mockResolvedValue({ id: 'share-existing' });

    const result = await tool.execute({ memoryId: 'mem-1', targetType: 'org' });

    const parsed = JSON.parse(result.output);
    expect(parsed.shareId).toBe('share-existing');
    expect(mockPrisma.memoryShare.create).not.toHaveBeenCalled();
  });

  it('rejects when memory not owned by user', async () => {
    mockPrisma.memoryItem.findUnique.mockResolvedValue({ id: 'mem-1', ownerId: 'user-2' });

    const result = await tool.execute({ memoryId: 'mem-1', targetType: 'org' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('only share your own');
  });

  it('rejects when memory not found', async () => {
    mockPrisma.memoryItem.findUnique.mockResolvedValue(null);

    const result = await tool.execute({ memoryId: 'bad-id', targetType: 'org' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('Memory item not found');
  });

  it('rejects when user not a member of the group', async () => {
    mockPrisma.memoryItem.findUnique.mockResolvedValue({ id: 'mem-1', ownerId: 'user-1' });
    mockPrisma.groupMember.findFirst.mockResolvedValue(null);

    const result = await tool.execute({ memoryId: 'mem-1', targetType: 'group', groupId: 'g-1' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('Group not found or you are not a member');
  });

  it('rejects when groupId missing for group target', async () => {
    mockPrisma.memoryItem.findUnique.mockResolvedValue({ id: 'mem-1', ownerId: 'user-1' });

    const result = await tool.execute({ memoryId: 'mem-1', targetType: 'group' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('groupId is required');
  });

  it('creates audit log entry for share', async () => {
    mockPrisma.memoryItem.findUnique.mockResolvedValue({ id: 'mem-1', ownerId: 'user-1' });
    mockPrisma.memoryShare.findFirst.mockResolvedValue(null);
    mockPrisma.memoryShare.create.mockResolvedValue({ id: 'share-1' });
    mockPrisma.auditLog.create.mockResolvedValue({});

    await tool.execute({ memoryId: 'mem-1', targetType: 'org' });

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        action: 'memory.share',
        resource: 'MemoryItem',
        resourceId: 'mem-1',
      }),
    });
  });
});
