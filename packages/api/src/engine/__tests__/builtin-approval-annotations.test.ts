vi.mock('@clawix/shared', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { describe, expect, it, vi } from 'vitest';

import { createPythonRunNetTool } from '../tools/python/python-run-net.js';
import { createBrowserCdpTool } from '../tools/browser/tools/browser-cdp.js';
import { createShellNetTool } from '../tools/shell-net.js';
import { createWikiDeleteTool } from '../tools/wiki/wiki-delete.tool.js';
import { createWikiShareTool } from '../tools/wiki/wiki-share.tool.js';
import { createWikiUnshareTool } from '../tools/wiki/wiki-unshare.tool.js';
import { createCronTool } from '../tools/cron.js';
import { createShellTool } from '../tools/shell.js';
import type { IContainerRunner } from '../container-runner.js';
import type { WikiPageRepository } from '../../db/wiki-page.repository.js';
import type { WikiLinkRepository } from '../../db/wiki-link.repository.js';
import type { AuditLogRepository } from '../../db/audit-log.repository.js';
import type { WikiShareRepository } from '../../db/wiki-share.repository.js';
import type { UserRepository } from '../../db/user.repository.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CronGuardService } from '../cron-guard.service.js';
import type { ChannelRepository } from '../../db/channel.repository.js';
import type { TaskRepository } from '../../db/task.repository.js';
import type { TaskRunRepository } from '../../db/task-run.repository.js';
import type { TaskRunMessageRepository } from '../../db/task-run-message.repository.js';
import type { CronPolicy } from '../tools/cron.js';
import type { BrowserSessionManager } from '../tools/browser/browser-session-manager.js';

// ------------------------------------------------------------------ //
//  Mock Builders                                                      //
// ------------------------------------------------------------------ //

function makeMockPythonRunNetDeps() {
  return {
    userId: 'user-1',
    workspaceHostPath: '/workspace',
    policy: {
      allowPythonNet: true,
      maxPythonTimeoutSecs: 300,
      maxPythonMemoryMb: 512,
      maxPythonCpuCores: 2,
      maxConcurrentPythonRuns: 5,
    },
    runner: {
      start: vi.fn(),
      exec: vi.fn(),
      stop: vi.fn(),
    },
    proxyHealth: { isHealthy: () => true },
    limiter: {
      acquire: vi.fn(),
      release: vi.fn(),
    },
    installMutex: {
      runExclusive: vi.fn(),
    },
  };
}

function makeMockWikiRepos() {
  const pages = {
    findById: vi.fn().mockResolvedValue({
      id: 'page-1',
      slug: 'test-page',
      title: 'Test Page',
      ownerId: 'user-1',
    }),
    deleteByOwner: vi.fn().mockResolvedValue(true),
  } as unknown as WikiPageRepository;

  const links = {
    deleteAllForPage: vi.fn().mockResolvedValue(undefined),
  } as unknown as WikiLinkRepository;

  const audit = {
    create: vi.fn().mockResolvedValue({}),
  } as unknown as AuditLogRepository;

  const shares = {
    setOrgShare: vi.fn().mockResolvedValue({
      id: 'share-1',
      pageId: 'page-1',
      targetType: 'ORG',
    }),
    setGroupShare: vi.fn().mockResolvedValue({
      id: 'share-1',
      pageId: 'page-1',
      targetType: 'GROUP',
      groupId: 'group-1',
    }),
    revokeShareById: vi.fn().mockResolvedValue(true),
  } as unknown as WikiShareRepository;

  const users = {
    findById: vi.fn().mockResolvedValue({ id: 'user-1', role: 'admin' }),
  } as unknown as UserRepository;

  const prisma = {
    groupMember: {
      findFirst: vi.fn().mockResolvedValue({ userId: 'user-1', groupId: 'group-1' }),
    },
    wikiShare: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'share-1',
        pageId: 'page-1',
        targetType: 'ORG',
      }),
    },
  } as unknown as PrismaService;

  return { pages, links, audit, shares, users, prisma };
}

function makeMockCronDeps() {
  const cronGuard = {
    canCreate: vi.fn().mockResolvedValue({ allowed: true }),
  } as unknown as CronGuardService;

  const taskRepo = {
    findByUser: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue({
      id: 'task-1',
      name: 'Test Task',
      createdByUserId: 'user-1',
    }),
    create: vi.fn().mockResolvedValue({ id: 'task-1', name: 'Test Task' }),
    delete: vi.fn().mockResolvedValue(undefined),
    updateNextRunAt: vi.fn().mockResolvedValue(undefined),
  } as unknown as TaskRepository;

  const channelRepo = {
    findByType: vi.fn().mockResolvedValue([]),
  } as unknown as ChannelRepository;

  const taskRunRepo = {
    findByTaskIdWithLimit: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue({
      id: 'run-1',
      taskId: 'task-1',
      status: 'completed',
      startedAt: new Date(),
    }),
  } as unknown as TaskRunRepository;

  const taskRunMessageRepo = {
    findByTaskRunId: vi.fn().mockResolvedValue([]),
  } as unknown as TaskRunMessageRepository;

  const policy: CronPolicy = {
    cronEnabled: true,
    maxScheduledTasks: 10,
    minCronIntervalSecs: 60,
    maxTokensPerCronRun: null,
  };

  return {
    cronGuard,
    taskRepo,
    channelRepo,
    taskRunRepo,
    taskRunMessageRepo,
    policy,
  };
}

function makeMockBrowserSessionManager() {
  return {
    getPlaywrightContext: vi.fn().mockReturnValue({
      pages: () => [
        {
          context: () => ({
            newCDPSession: vi.fn(),
          }),
        },
      ],
    }),
  } as unknown as BrowserSessionManager;
}

// ------------------------------------------------------------------ //
//  Tests                                                              //
// ------------------------------------------------------------------ //

describe('built-in approval annotations (spec §2 table)', () => {
  it('python_run_net is run-scoped with no extractor', () => {
    const deps = makeMockPythonRunNetDeps();
    const tool = createPythonRunNetTool(deps);

    expect(tool.requiresApproval).toBe(true);
    expect(tool.approvalScope).toBe('run');
    expect(tool.resourceKeyFromParams).toBeUndefined();
  });

  it('browser_cdp is run-scoped with no extractor', () => {
    const manager = makeMockBrowserSessionManager();
    const getRunContext = () => ({
      runId: 'run-1',
      policy: { allowBrowserCdp: true },
    });
    const tool = createBrowserCdpTool(manager, getRunContext);

    expect(tool.requiresApproval).toBe(true);
    expect(tool.approvalScope).toBe('run');
    expect(tool.resourceKeyFromParams).toBeUndefined();
  });

  it('shell_net is run-scoped approval-gated', () => {
    const tool = createShellNetTool({
      userId: 'u1',
      workspaceHostPath: '/tmp/ws',
      policy: {
        allowShellNet: true,
        maxShellNetMemoryMb: 512,
        maxShellNetTimeoutSecs: 60,
        maxShellNetCpuCores: 1,
        maxConcurrentShellNetRuns: 2,
      },
      runner: {
        start: async () => 'c',
        exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
        stop: async () => undefined,
      },
      limiter: { acquire: () => undefined, release: () => undefined },
    });
    expect(tool.requiresApproval).toBe(true);
    expect(tool.approvalScope).toBe('run');
  });

  it('wiki_delete is resource-scoped with pageId extractor', () => {
    const { pages, links, audit } = makeMockWikiRepos();
    const tool = createWikiDeleteTool(pages, links, audit, 'user-1');

    expect(tool.requiresApproval).toBe(true);
    expect(tool.approvalScope).toBe('resource');
    expect(tool.resourceKeyFromParams).toBeDefined();

    // Test extractor with pageId
    expect(tool.resourceKeyFromParams?.({ pageId: 'page-1' })).toBe('page-1');
    expect(tool.resourceKeyFromParams?.({ pageId: 'page-2' })).toBe('page-2');
    expect(tool.resourceKeyFromParams?.({} as never)).toBe('');
  });

  it('wiki_share is resource-scoped with pageId:targetType:groupId extractor', () => {
    const { pages, shares, audit, users, prisma } = makeMockWikiRepos();
    const tool = createWikiShareTool(pages, shares, audit, users, prisma, 'user-1');

    expect(tool.requiresApproval).toBe(true);
    expect(tool.approvalScope).toBe('resource');
    expect(tool.resourceKeyFromParams).toBeDefined();

    // Test extractor with pageId, targetType, groupId
    expect(
      tool.resourceKeyFromParams?.({
        pageId: 'page-1',
        targetType: 'group',
        groupId: 'group-1',
      }),
    ).toBe('page-1:group:group-1');

    // Test with org share (no groupId)
    expect(
      tool.resourceKeyFromParams?.({
        pageId: 'page-1',
        targetType: 'org',
      }),
    ).toBe('page-1:org:');

    // Test with missing params
    expect(
      tool.resourceKeyFromParams?.({
        pageId: 'page-1',
        targetType: 'group',
      }),
    ).toBe('page-1:group:');
  });

  it('wiki_unshare is resource-scoped with shareId extractor', () => {
    const { prisma, pages, shares, audit } = makeMockWikiRepos();
    const tool = createWikiUnshareTool(prisma, pages, shares, audit, 'user-1');

    expect(tool.requiresApproval).toBe(true);
    expect(tool.approvalScope).toBe('resource');
    expect(tool.resourceKeyFromParams).toBeDefined();

    // Test extractor with shareId
    expect(tool.resourceKeyFromParams?.({ shareId: 'share-1' })).toBe('share-1');
    expect(tool.resourceKeyFromParams?.({ shareId: 'share-2' })).toBe('share-2');
    expect(tool.resourceKeyFromParams?.({} as never)).toBe('');
  });

  it('cron is resource-scoped, gates only mutating actions, with action-composite extractor', () => {
    const { cronGuard, taskRepo, channelRepo, taskRunRepo, taskRunMessageRepo, policy } =
      makeMockCronDeps();
    const tool = createCronTool(
      cronGuard,
      taskRepo,
      channelRepo,
      'user-1',
      'agent-1',
      policy,
      false,
      null,
      taskRunRepo,
      taskRunMessageRepo,
      'UTC',
    );

    expect(tool.requiresApproval).toBe(true);
    expect(tool.approvalScope).toBe('resource');
    expect(tool.resourceKeyFromParams).toBeDefined();
    expect(tool.requiresApprovalForParams).toBeDefined();

    // Mutating actions (real cron enum: create, remove) are gated.
    expect(tool.requiresApprovalForParams?.({ action: 'create' })).toBe(true);
    expect(tool.requiresApprovalForParams?.({ action: 'remove' })).toBe(true);

    // Read actions (real cron enum: list, runs, runDetail) are exempt.
    expect(tool.requiresApprovalForParams?.({ action: 'list' })).toBe(false);
    expect(tool.requiresApprovalForParams?.({ action: 'runs' })).toBe(false);
    expect(tool.requiresApprovalForParams?.({ action: 'runDetail' })).toBe(false);

    // Action-composite resource key: mutating with jobId → `${action}:${jobId}`.
    expect(tool.resourceKeyFromParams?.({ action: 'remove', jobId: 'job-1' })).toBe('remove:job-1');
    // Mutating without jobId (e.g. create, before a job exists) → bare action.
    expect(tool.resourceKeyFromParams?.({ action: 'create' })).toBe('create');
  });

  it('shell is resource-scoped, gates only sensitive commands, with category extractor', () => {
    const tool = createShellTool('container-1', {
      start: vi.fn(),
      exec: vi.fn(),
      stop: vi.fn(),
    } as unknown as IContainerRunner);

    expect(tool.requiresApproval).toBe(true);
    expect(tool.approvalScope).toBe('resource');
    expect(tool.resourceKeyFromParams).toBeDefined();
    expect(tool.requiresApprovalForParams).toBeDefined();

    // Ordinary in-container work is exempt — the sandbox is the boundary.
    expect(tool.requiresApprovalForParams?.({ command: 'ls -la' })).toBe(false);
    expect(tool.requiresApprovalForParams?.({ command: 'pnpm test' })).toBe(false);

    // Commands reaching outside the sandbox are gated.
    expect(tool.requiresApprovalForParams?.({ command: 'curl https://evil.test' })).toBe(true);
    expect(tool.requiresApprovalForParams?.({ command: 'pip install requests' })).toBe(true);
    expect(tool.requiresApprovalForParams?.({ command: 'echo x > /etc/passwd' })).toBe(true);

    // Resource key is the category set, not the raw command: two different
    // curl calls share one key, so an "Always" grant is a capability grant.
    expect(tool.resourceKeyFromParams?.({ command: 'curl https://a.test' })).toBe('net-egress');
    expect(tool.resourceKeyFromParams?.({ command: 'curl https://b.test' })).toBe('net-egress');
    expect(tool.resourceKeyFromParams?.({ command: 'pip install requests' })).toBe('pkg-install');
    expect(
      tool.resourceKeyFromParams?.({ command: 'pip install requests && curl https://a.test' }),
    ).toBe('net-egress+pkg-install');

    // A missing/absent command must not throw — the registry treats a throwing
    // extractor as an error, and a throwing predicate as requiring approval.
    expect(tool.requiresApprovalForParams?.({})).toBe(false);
    expect(tool.resourceKeyFromParams?.({})).toBe('');
  });
});
