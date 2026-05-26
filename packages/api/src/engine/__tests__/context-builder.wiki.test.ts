/**
 * Tests for the wiki memory path in ContextBuilderService.
 *
 * These tests verify that:
 *  - The wiki path is always reached (WikiPageRepository methods are called)
 *  - renderWikiContext output appears in the system prompt
 *  - The legacy MemoryItemRepository methods are NOT called
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@clawix/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clawix/shared')>();
  return {
    ...actual,
    createLogger: vi.fn().mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

vi.mock('fs/promises');

import { ContextBuilderService } from '../context-builder.service.js';
import type { ContextBuildParams } from '../context-builder.types.js';
import type { BootstrapFileService } from '../bootstrap-file.service.js';
import type { SkillLoaderService } from '../skill-loader.service.js';
import type { PolicyRepository } from '../../db/policy.repository.js';
import type { UserRepository } from '../../../src/db/user.repository.js';
import type { SystemSettingsService } from '../../system-settings/system-settings.service.js';
import type { SessionRepository } from '../../db/session.repository.js';
import type { WikiPageRepository } from '../../db/wiki-page.repository.js';
import type { WikiBootstrapService } from '../wiki/wiki-bootstrap.service.js';
import type { SessionSearchService } from '../session-recall/session-search.service.js';

const baseParams: ContextBuildParams = {
  agentDef: {
    name: 'TestAgent',
    description: 'A test assistant',
    systemPrompt: 'You are helpful.',
  },
  history: [],
  input: 'Hello',
  userId: 'user-wiki-1',
  channel: 'telegram',
  chatId: '123',
  userName: 'Alice',
};

function makeWikiPage(over: {
  id?: string;
  slug?: string;
  title?: string;
  summary?: string;
  content?: string;
  tags?: string[];
  scope?: 'AMBIENT' | 'ARCHIVED';
}) {
  const now = new Date('2026-05-17T00:00:00Z');
  return {
    id: over.id ?? 'p1',
    slug: over.slug ?? 'page',
    title: over.title ?? 'Page',
    summary: over.summary ?? 'A page',
    content: over.content ?? 'Some content',
    tags: over.tags ?? [],
    scope: over.scope ?? 'ARCHIVED',
    ownerId: 'user-wiki-1',
    createdAt: now,
    updatedAt: now,
  };
}

describe('ContextBuilderService — wiki memory branch', () => {
  function makeService(
    wikiPageRepoOverride?: Partial<Record<keyof WikiPageRepository, unknown>>,
    wikiBootstrapOverride?: Partial<Record<keyof WikiBootstrapService, unknown>>,
  ) {
    const mockWikiPageRepo = {
      listOwnedByUser: vi.fn().mockResolvedValue([]),
      findDailyNotes: vi.fn().mockResolvedValue([]),
      findVisibleToUser: vi.fn().mockResolvedValue([]),
      ...wikiPageRepoOverride,
    };

    const mockWikiBootstrap = {
      ensureMigrated: vi.fn().mockResolvedValue(undefined),
      ...wikiBootstrapOverride,
    };

    const noopBootstrap = { loadBootstrapFiles: vi.fn().mockResolvedValue([]) };
    const noopSkillLoader = {
      buildSkillsSummary: vi.fn().mockResolvedValue({ xml: '', stalenessMap: new Map() }),
    };
    const noopPolicyRepo = {
      findById: vi.fn().mockResolvedValue({ cronEnabled: false }),
    };
    const noopUserRepo = {
      findById: vi.fn().mockResolvedValue({ policyId: 'p-1' }),
    };
    const noopSystemSettings = {
      get: vi.fn().mockResolvedValue({
        cronDefaultTokenBudget: 10000,
        cronExecutionTimeoutMs: 300000,
        cronTokenGracePercent: 10,
        defaultTimezone: 'UTC',
      }),
    };
    const noopSessionRepo = {
      findById: vi.fn(),
      setCachedSystemPrompt: vi.fn().mockResolvedValue(undefined),
    };

    const noopSessionSearch = {
      recentSessions: vi.fn().mockResolvedValue([]),
      search: vi.fn().mockResolvedValue([]),
    };

    const service = new ContextBuilderService(
      noopBootstrap as unknown as BootstrapFileService,
      noopSkillLoader as unknown as SkillLoaderService,
      noopPolicyRepo as unknown as PolicyRepository,
      noopUserRepo as unknown as UserRepository,
      noopSystemSettings as unknown as SystemSettingsService,
      noopSessionRepo as unknown as SessionRepository,
      mockWikiPageRepo as unknown as WikiPageRepository,
      mockWikiBootstrap as unknown as WikiBootstrapService,
      noopSessionSearch as unknown as SessionSearchService,
    );

    return { service, mockWikiPageRepo, mockWikiBootstrap, noopSessionSearch };
  }

  it('calls WikiPageRepository methods and includes wiki sections', async () => {
    const { service, mockWikiPageRepo } = makeService({
      listOwnedByUser: vi.fn().mockResolvedValue([
        makeWikiPage({
          id: 'profile-1',
          slug: 'user-profile',
          title: 'User Profile',
          content: 'User prefers TypeScript.',
          tags: ['kind:profile'],
          scope: 'AMBIENT',
        }),
        makeWikiPage({
          id: 'notes-1',
          slug: 'project-notes',
          title: 'Project Notes',
          content: 'Working on Clawix.',
          scope: 'AMBIENT',
        }),
      ]),
      findVisibleToUser: vi.fn().mockResolvedValue([
        makeWikiPage({
          id: 'idx-1',
          slug: 'leave-policy',
          title: 'Leave Policy',
          summary: 'PTO rules',
          tags: ['domain:hr'],
        }),
      ]),
    });

    const { messages } = await service.buildMessages(baseParams);
    const system = messages[0]!.content as string;

    // Wiki sections should be present. User Profile no longer appears as a
    // wiki section — it lives in USER.md (file-based) and is injected
    // separately by BootstrapFileService.
    expect(system).not.toMatch(/^## User Profile$/m);
    expect(system).toContain('## Long-term Memory');
    expect(system).toContain('User prefers TypeScript');
    expect(system).toContain('Working on Clawix');
    expect(system).toContain('## Wiki Index');
    expect(system).toContain('leave-policy');

    // Wiki repo should have been called
    expect(mockWikiPageRepo.listOwnedByUser).toHaveBeenCalledWith('user-wiki-1', { limit: 2000 });
    expect(mockWikiPageRepo.findVisibleToUser).toHaveBeenCalledWith('user-wiki-1', { limit: 400 });
  });

  it('calls WikiPageRepository methods', async () => {
    const { service, mockWikiPageRepo } = makeService();

    await service.buildMessages(baseParams);

    expect(mockWikiPageRepo.listOwnedByUser).toHaveBeenCalledWith('user-wiki-1', { limit: 2000 });
  });

  it('calls ensureMigrated when workspacePath is provided', async () => {
    const { service, mockWikiBootstrap } = makeService();

    await service.buildMessages({ ...baseParams, workspacePath: '/workspace/user-wiki-1' });

    expect(mockWikiBootstrap.ensureMigrated).toHaveBeenCalledWith(
      'user-wiki-1',
      '/workspace/user-wiki-1',
    );
  });

  it('skips ensureMigrated when workspacePath is not provided', async () => {
    const { service, mockWikiBootstrap } = makeService();

    await service.buildMessages(baseParams); // no workspacePath

    expect(mockWikiBootstrap.ensureMigrated).not.toHaveBeenCalled();
  });

  it('returns null memory section gracefully when wiki repos are empty', async () => {
    const { service } = makeService();

    const { messages } = await service.buildMessages(baseParams);
    const system = messages[0]!.content as string;

    // No memory section when all wiki data is empty
    expect(system).not.toContain('# Memory');
  });

  it('always runs the wiki path regardless of environment (flag removed)', async () => {
    // The FEATURE_WIKI_MEMORY env var is no longer read; wiki runs unconditionally.
    const { service, mockWikiPageRepo } = makeService();

    const { messages } = await service.buildMessages(baseParams);
    const system = messages[0]!.content as string;

    // Wiki repo IS called (unconditional path); empty results → no memory section rendered
    expect(mockWikiPageRepo.listOwnedByUser).toHaveBeenCalledWith('user-wiki-1', { limit: 2000 });
    expect(system).not.toContain('# Memory');
  });

  it('handles wiki repo error gracefully and returns null', async () => {
    const { service } = makeService({
      listOwnedByUser: vi.fn().mockRejectedValue(new Error('DB connection lost')),
    });

    // Should not throw, just return null memory section
    const { messages } = await service.buildMessages(baseParams);
    const system = messages[0]!.content as string;

    expect(system).toContain('# TestAgent'); // agent still renders
    expect(system).not.toContain('# Memory'); // memory section absent
  });

  it('injects a Recent Sessions block from SessionSearchService', async () => {
    const { service, noopSessionSearch } = makeService();
    noopSessionSearch.recentSessions = vi
      .fn()
      .mockResolvedValue([
        { title: 'Wiki memory redesign', createdAt: new Date('2026-05-26T00:00:00Z') },
      ]);

    const { messages } = await service.buildMessages(baseParams);
    const system = messages[0]!.content as string;

    expect(system).toContain('## Recent Sessions');
    expect(system).toContain('Wiki memory redesign');
    expect(noopSessionSearch.recentSessions).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-wiki-1', limit: 10 }),
    );
  });

  it('omits the Recent Sessions block for sub-agents', async () => {
    const { service, noopSessionSearch } = makeService();
    noopSessionSearch.recentSessions = vi
      .fn()
      .mockResolvedValue([
        { title: 'Wiki memory redesign', createdAt: new Date('2026-05-26T00:00:00Z') },
      ]);

    const { messages } = await service.buildMessages({ ...baseParams, isSubAgent: true });
    const system = messages[0]!.content as string;

    expect(system).not.toContain('## Recent Sessions');
    expect(noopSessionSearch.recentSessions).not.toHaveBeenCalled();
  });
});
