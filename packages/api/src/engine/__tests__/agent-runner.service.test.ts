import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ------------------------------------------------------------------ //
//  Module mocks — must be hoisted before imports                      //
// ------------------------------------------------------------------ //

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

vi.mock('../providers/provider-factory.js', () => ({
  createProvider: vi.fn(),
}));

vi.mock('../reasoning-loop.js', () => ({
  ReasoningLoop: vi.fn(),
}));

vi.mock('../tools/index.js', () => ({
  registerBuiltinTools: vi.fn(),
  registerMemoryTools: vi.fn(),
  registerCronTools: vi.fn(),
}));

vi.mock('../tools/spawn.js', () => ({
  createSpawnTool: vi
    .fn()
    .mockReturnValue({ name: 'spawn', description: 'spawn', parameters: {}, execute: vi.fn() }),
}));

vi.mock('../tools/web/index.js', () => ({
  registerWebTools: vi.fn(),
}));

vi.mock('../resilience.js', () => ({
  ResilientLLMProvider: vi.fn().mockImplementation((inner: unknown) => inner),
}));

vi.mock('../context-builder.service.js', () => ({
  ContextBuilderService: vi.fn(),
}));

vi.mock('../workspace-resolver.js', () => ({
  resolveWorkspacePaths: vi.fn().mockReturnValue({
    localPath: '/data/users/user-1/workspace',
    hostPath: '/host/data/users/user-1/workspace',
  }),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// ------------------------------------------------------------------ //
//  Imports after mocks                                                //
// ------------------------------------------------------------------ //

import { AgentRunnerService } from '../agent-runner.service.js';
import type { RunOptions } from '../agent-runner.types.js';
import type { SessionManagerService } from '../session-manager.service.js';
import type { ContainerRunner } from '../container-runner.js';
import type { TokenCounterService } from '../token-counter.service.js';
import type { AgentRunRepository } from '../../db/agent-run.repository.js';
import type { AgentDefinitionRepository } from '../../db/agent-definition.repository.js';
import type { UserRepository } from '../../db/user.repository.js';
import type { UserAgentRepository } from '../../db/user-agent.repository.js';
import type { MemoryConsolidationService } from '../memory-consolidation.service.js';
import type { ContainerPoolService } from '../container-pool.service.js';
import { createProvider } from '../providers/provider-factory.js';
import { ReasoningLoop } from '../reasoning-loop.js';
import { registerBuiltinTools } from '../tools/index.js';
import { createSpawnTool } from '../tools/spawn.js';
import type { ContextBuilderService } from '../context-builder.service.js';
import type { SearchProviderRegistry } from '../tools/web/search-provider.js';

// ------------------------------------------------------------------ //
//  Test fixtures                                                      //
// ------------------------------------------------------------------ //

const mockAgentDef = {
  id: 'agent-def-1',
  name: 'test-agent',
  description: null,
  systemPrompt: 'You are a helpful assistant.',
  provider: 'openai',
  model: 'gpt-4',
  apiBaseUrl: null,
  skillIds: [],
  maxTokensPerRun: 4000,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  containerConfig: {
    image: 'clawix-agent:latest',
    cpuLimit: '0.5',
    memoryLimit: '512m',
    timeoutSeconds: 300,
    readOnlyRootfs: false,
    allowedMounts: [],
  },
};

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  passwordHash: 'hash',
  policyId: 'policy-1',
  role: 'member' as const,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockSession = {
  id: 'sess-1',
  userId: 'user-1',
  agentDefinitionId: 'agent-def-1',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockAgentRun = {
  id: 'run-1',
  agentDefinitionId: 'agent-def-1',
  sessionId: 'sess-1',
  status: 'running' as const,
  input: 'Hello!',
  output: null,
  error: null,
  tokenUsage: null,
  startedAt: new Date(),
  completedAt: null,
};

const mockLoopResult = {
  content: 'Hello back!',
  messages: [
    { role: 'system' as const, content: 'You are a helpful assistant.' },
    { role: 'user' as const, content: 'Hello!' },
    { role: 'assistant' as const, content: 'Hello back!' },
  ],
  totalUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  iterations: 1,
  hitMaxIterations: false,
};

const mockProvider = {
  name: 'openai',
  chat: vi.fn(),
};

const mockPolicy = {
  id: 'policy-1',
  name: 'default',
  description: null,
  maxTokenBudget: null,
  maxAgents: 5,
  maxSkills: 50,
  maxMemoryItems: 100,
  maxGroupsOwned: 3,
  allowedProviders: ['openai', 'anthropic'],
  features: {},
  cronEnabled: false,
  maxScheduledTasks: 5,
  minCronIntervalSecs: 300,
  maxTokensPerCronRun: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ------------------------------------------------------------------ //
//  Helper: build mocks                                                //
// ------------------------------------------------------------------ //

function buildMocks() {
  const mockSessionManager: {
    getOrCreate: ReturnType<typeof vi.fn>;
    loadMessages: ReturnType<typeof vi.fn>;
    saveMessages: ReturnType<typeof vi.fn>;
    compact: ReturnType<typeof vi.fn>;
  } = {
    getOrCreate: vi.fn().mockResolvedValue(mockSession),
    loadMessages: vi.fn().mockResolvedValue([]),
    saveMessages: vi.fn().mockResolvedValue(['saved-msg-1', 'saved-msg-2']),
    compact: vi.fn().mockResolvedValue(undefined),
  };

  const mockMemoryConsolidation: {
    consolidateIfNeeded: ReturnType<typeof vi.fn>;
    estimateSessionTokens: ReturnType<typeof vi.fn>;
    getTokenWarningState: ReturnType<typeof vi.fn>;
  } = {
    consolidateIfNeeded: vi.fn().mockResolvedValue(undefined),
    estimateSessionTokens: vi.fn().mockResolvedValue(0),
    getTokenWarningState: vi.fn().mockResolvedValue({
      estimated: 0,
      threshold: 65536,
      ratio: 0,
      warning: 'none',
    }),
  };

  const mockContainerRunner: {
    start: ReturnType<typeof vi.fn>;
    exec: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  } = {
    start: vi.fn().mockResolvedValue('container-1'),
    exec: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
  };

  const mockContainerPool: {
    acquire: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
    evict: ReturnType<typeof vi.fn>;
    drainAll: ReturnType<typeof vi.fn>;
    stats: ReturnType<typeof vi.fn>;
  } = {
    acquire: vi.fn().mockResolvedValue('container-1'),
    release: vi.fn(),
    evict: vi.fn().mockResolvedValue(undefined),
    drainAll: vi.fn().mockResolvedValue(undefined),
    stats: vi.fn().mockReturnValue({ active: 0, idle: 0, ephemeral: 0, total: 0 }),
  };

  const mockTokenCounter: {
    checkBudget: ReturnType<typeof vi.fn>;
    checkProviderAllowed: ReturnType<typeof vi.fn>;
    recordAggregateUsage: ReturnType<typeof vi.fn>;
  } = {
    checkBudget: vi.fn().mockResolvedValue({ allowed: true, currentUsageUsd: 0, limitUsd: null }),
    checkProviderAllowed: vi.fn().mockResolvedValue(true),
    recordAggregateUsage: vi.fn().mockResolvedValue(undefined),
  };

  const mockAgentRunRepo: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  } = {
    create: vi.fn().mockResolvedValue(mockAgentRun),
    update: vi.fn().mockResolvedValue({ ...mockAgentRun, status: 'completed' }),
  };

  const mockAgentDefRepo: {
    findById: ReturnType<typeof vi.fn>;
    findActiveWorkers: ReturnType<typeof vi.fn>;
  } = {
    findById: vi.fn().mockResolvedValue(mockAgentDef),
    findActiveWorkers: vi.fn().mockResolvedValue([]),
  };

  const mockUserRepo: {
    findById: ReturnType<typeof vi.fn>;
  } = {
    findById: vi.fn().mockResolvedValue(mockUser),
  };

  const mockUserAgentRepo: {
    findByUserId: ReturnType<typeof vi.fn>;
  } = {
    findByUserId: vi.fn().mockResolvedValue({
      id: 'ua-1',
      userId: 'user-1',
      agentDefinitionId: 'agent-def-1',
      workspacePath: 'users/user-1/workspace',
    }),
  };

  const mockTaskExecutor: {
    submit: ReturnType<typeof vi.fn>;
  } = {
    submit: vi.fn(),
  };

  const mockContextBuilder: {
    buildMessages: ReturnType<typeof vi.fn>;
  } = {
    buildMessages: vi.fn().mockResolvedValue([
      { role: 'system' as const, content: 'enriched system prompt' },
      { role: 'user' as const, content: '[Runtime Context]\n...\n\nHello!' },
    ]),
  };

  const mockWorkspaceSeeder: {
    seedWorkspace: ReturnType<typeof vi.fn>;
  } = {
    seedWorkspace: vi.fn().mockResolvedValue(undefined),
  };

  const mockPolicyRepo: {
    findById: ReturnType<typeof vi.fn>;
  } = {
    findById: vi.fn().mockResolvedValue(mockPolicy),
  };

  const mockTaskRepo: {
    findByUser: ReturnType<typeof vi.fn>;
    findActiveCountByUser: ReturnType<typeof vi.fn>;
    findRunningCountByUser: ReturnType<typeof vi.fn>;
  } = {
    findByUser: vi.fn().mockResolvedValue([]),
    findActiveCountByUser: vi.fn().mockResolvedValue(0),
    findRunningCountByUser: vi.fn().mockResolvedValue(0),
  };

  const mockCronGuardService: {
    canCreate: ReturnType<typeof vi.fn>;
    canDispatch: ReturnType<typeof vi.fn>;
  } = {
    canCreate: vi.fn().mockResolvedValue({ allowed: true }),
    canDispatch: vi.fn().mockResolvedValue({ allowed: true }),
  };

  const mockProviderConfig: {
    resolveProvider: ReturnType<typeof vi.fn>;
  } = {
    resolveProvider: vi.fn().mockResolvedValue({ apiKey: 'test-api-key', apiBaseUrl: null }),
  };

  return {
    mockSessionManager,
    mockContainerRunner,
    mockContainerPool,
    mockTokenCounter,
    mockAgentRunRepo,
    mockAgentDefRepo,
    mockUserRepo,
    mockUserAgentRepo,
    mockMemoryConsolidation,
    mockTaskExecutor,
    mockContextBuilder,
    mockWorkspaceSeeder,
    mockPolicyRepo,
    mockTaskRepo,
    mockCronGuardService,
    mockProviderConfig,
  };
}

// ------------------------------------------------------------------ //
//  Tests                                                              //
// ------------------------------------------------------------------ //

describe('AgentRunnerService', () => {
  let service: AgentRunnerService;
  let mocks: ReturnType<typeof buildMocks>;
  let mockLoopInstance: { run: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['OPENAI_API_KEY'] = 'test-key';

    mocks = buildMocks();

    // Set up mock ReasoningLoop instance
    mockLoopInstance = { run: vi.fn().mockResolvedValue(mockLoopResult) };
    vi.mocked(ReasoningLoop).mockImplementation(() => mockLoopInstance as unknown as ReasoningLoop);

    // Set up mock provider factory
    vi.mocked(createProvider).mockReturnValue(mockProvider);

    service = new AgentRunnerService(
      mocks.mockSessionManager as unknown as SessionManagerService,
      mocks.mockContainerRunner as unknown as ContainerRunner,
      mocks.mockContainerPool as unknown as ContainerPoolService,
      mocks.mockTokenCounter as unknown as TokenCounterService,
      mocks.mockAgentRunRepo as unknown as AgentRunRepository,
      mocks.mockAgentDefRepo as unknown as AgentDefinitionRepository,
      mocks.mockUserRepo as unknown as UserRepository,
      mocks.mockUserAgentRepo as unknown as UserAgentRepository,
      mocks.mockMemoryConsolidation as unknown as MemoryConsolidationService,
      mocks.mockContextBuilder as unknown as ContextBuilderService,
      {} as unknown as SearchProviderRegistry,
      { get: () => mocks.mockTaskExecutor } as unknown as import('@nestjs/core').ModuleRef,
      {} as unknown as import('../../prisma/prisma.service.js').PrismaService,
      {
        findVisibleToUser: vi.fn().mockResolvedValue([]),
      } as unknown as import('../../db/memory-item.repository.js').MemoryItemRepository,
      mocks.mockWorkspaceSeeder as unknown as import('../workspace-seeder.service.js').WorkspaceSeederService,
      mocks.mockPolicyRepo as unknown as import('../../db/policy.repository.js').PolicyRepository,
      {} as unknown as import('../../db/channel.repository.js').ChannelRepository,
      mocks.mockTaskRepo as unknown as import('../../db/task.repository.js').TaskRepository,
      mocks.mockCronGuardService as unknown as import('../cron-guard.service.js').CronGuardService,
      mocks.mockProviderConfig as unknown as import('../../provider-config/provider-config.service.js').ProviderConfigService,
    );
  });

  afterEach(() => {
    delete process.env['OPENAI_API_KEY'];
  });

  const defaultOptions: RunOptions = {
    agentDefinitionId: 'agent-def-1',
    input: 'Hello!',
    userId: 'user-1',
  };

  // ---------------------------------------------------------------- //
  //  Test 1: Happy-path lifecycle returns completed RunResult         //
  // ---------------------------------------------------------------- //

  it('runs a complete agent lifecycle and returns RunResult with status completed', async () => {
    const result = await service.run(defaultOptions);

    expect(result.agentRunId).toBe('run-1');
    expect(result.sessionId).toBe('sess-1');
    expect(result.status).toBe('completed');
    expect(result.output).toBe('Hello back!');
    expect(result.tokenUsage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      model: 'gpt-4',
      estimatedCostUsd: 0,
    });
    // The last assistant message ID from saveMessages should be threaded through
    expect(result.responseMessageId).toBe('saved-msg-1');
  });

  // ---------------------------------------------------------------- //
  //  Test 2: checkBudget is called                                    //
  // ---------------------------------------------------------------- //

  it('checks budget before execution', async () => {
    await service.run(defaultOptions);

    expect(mocks.mockTokenCounter.checkBudget).toHaveBeenCalledWith('user-1', 'policy-1');
  });

  // ---------------------------------------------------------------- //
  //  Test 3: Rejects when budget exceeded                             //
  // ---------------------------------------------------------------- //

  it('rejects when budget exceeded', async () => {
    mocks.mockTokenCounter.checkBudget.mockResolvedValue({
      allowed: false,
      currentUsageUsd: 10,
      limitUsd: 5,
    });

    await expect(service.run(defaultOptions)).rejects.toThrow(/budget/i);
  });

  // ---------------------------------------------------------------- //
  //  Test 4: Rejects when provider not allowed                        //
  // ---------------------------------------------------------------- //

  it('rejects when provider not allowed', async () => {
    mocks.mockTokenCounter.checkProviderAllowed.mockResolvedValue(false);

    await expect(service.run(defaultOptions)).rejects.toThrow(/provider/i);
  });

  // ---------------------------------------------------------------- //
  //  Test 5: Evicts and releases pool container on error             //
  // ---------------------------------------------------------------- //

  it('evicts and releases pool container on error (primary agent)', async () => {
    mockLoopInstance.run.mockRejectedValue(new Error('LLM error'));

    await expect(service.run(defaultOptions)).rejects.toThrow('LLM error');

    expect(mocks.mockContainerPool.evict).toHaveBeenCalledWith('sess-1');
    expect(mocks.mockContainerPool.release).toHaveBeenCalledWith('sess-1');
  });

  // ---------------------------------------------------------------- //
  //  Test 6: Updates AgentRun to failed on error                      //
  // ---------------------------------------------------------------- //

  it('updates AgentRun to failed status on error', async () => {
    const loopError = new Error('LLM explosion');
    mockLoopInstance.run.mockRejectedValue(loopError);

    await expect(service.run(defaultOptions)).rejects.toThrow('LLM explosion');

    expect(mocks.mockAgentRunRepo.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'failed',
        error: 'LLM explosion',
      }),
    );
  });

  // ---------------------------------------------------------------- //
  //  Test 7: Records token usage after successful run                 //
  // ---------------------------------------------------------------- //

  it('records token usage after successful run via recordAggregateUsage', async () => {
    await service.run(defaultOptions);

    expect(mocks.mockTokenCounter.recordAggregateUsage).toHaveBeenCalledWith({
      usage: mockLoopResult.totalUsage,
      agentRunId: 'run-1',
      userId: 'user-1',
      providerName: 'openai',
      model: 'gpt-4',
    });
  });

  // ---------------------------------------------------------------- //
  //  Test 8: Throws when agent definition is inactive                 //
  // ---------------------------------------------------------------- //

  it('throws when agent definition is inactive', async () => {
    mocks.mockAgentDefRepo.findById.mockResolvedValue({ ...mockAgentDef, isActive: false });

    await expect(service.run(defaultOptions)).rejects.toThrow(/inactive/i);
  });

  // ---------------------------------------------------------------- //
  //  Test 9: Throws when API key is missing                           //
  // ---------------------------------------------------------------- //

  it('throws when provider credentials cannot be resolved', async () => {
    mocks.mockProviderConfig.resolveProvider.mockRejectedValueOnce(
      new Error('No credentials configured for provider openai'),
    );

    await expect(service.run(defaultOptions)).rejects.toThrow(/credentials/i);
  });

  // ---------------------------------------------------------------- //
  //  Test 10: registerBuiltinTools is called with containerId         //
  // ---------------------------------------------------------------- //

  it('registers builtin tools with the container ID', async () => {
    await service.run(defaultOptions);

    expect(vi.mocked(registerBuiltinTools)).toHaveBeenCalledWith(
      expect.any(Object), // ToolRegistry instance
      'container-1',
      mocks.mockContainerRunner,
    );
  });

  // ---------------------------------------------------------------- //
  //  Test 11: Session is created before AgentRun                     //
  // ---------------------------------------------------------------- //

  it('gets or creates session before creating AgentRun', async () => {
    const callOrder: string[] = [];
    mocks.mockSessionManager.getOrCreate.mockImplementation(async () => {
      callOrder.push('getOrCreate');
      return mockSession;
    });
    mocks.mockAgentRunRepo.create.mockImplementation(async () => {
      callOrder.push('createAgentRun');
      return mockAgentRun;
    });

    await service.run(defaultOptions);

    expect(callOrder).toEqual(['getOrCreate', 'createAgentRun']);
  });

  // ---------------------------------------------------------------- //
  //  Test 12: Updates AgentRun to completed on success                //
  // ---------------------------------------------------------------- //

  it('updates AgentRun to completed status on success', async () => {
    await service.run(defaultOptions);

    expect(mocks.mockAgentRunRepo.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'completed',
        output: 'Hello back!',
      }),
    );
  });

  // ---------------------------------------------------------------- //
  //  Test 13: Calls consolidateIfNeeded after saving loop messages   //
  // ---------------------------------------------------------------- //

  it('calls consolidateIfNeeded with session id and run context after loop', async () => {
    await service.run(defaultOptions);

    expect(mocks.mockMemoryConsolidation.consolidateIfNeeded).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        containerId: 'container-1',
        agentRunId: 'run-1',
        userId: 'user-1',
      }),
    );
  });

  // ---------------------------------------------------------------- //
  //  Test 14: Does not register spawn tool when isSubAgent is true    //
  // ---------------------------------------------------------------- //

  it('does not register spawn tool when isSubAgent is true', async () => {
    await service.run({ ...defaultOptions, isSubAgent: true });

    expect(vi.mocked(createSpawnTool)).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------- //
  //  Test 15: Reuses existing AgentRun when agentRunId is provided    //
  // ---------------------------------------------------------------- //

  it('reuses existing AgentRun when agentRunId is provided', async () => {
    const existingRunId = 'run-existing';
    const reusedRun = { ...mockAgentRun, id: existingRunId, status: 'running' as const };
    mocks.mockAgentRunRepo.update.mockResolvedValueOnce(reusedRun);

    const result = await service.run({ ...defaultOptions, agentRunId: existingRunId });

    // Should call update (reuse), not create
    expect(mocks.mockAgentRunRepo.update).toHaveBeenCalledWith(existingRunId, {
      status: 'running',
      sessionId: 'sess-1',
    });
    expect(mocks.mockAgentRunRepo.create).not.toHaveBeenCalled();
    expect(result.agentRunId).toBe(existingRunId);
  });

  // ---------------------------------------------------------------- //
  //  Test 16: Uses ContainerPoolService.acquire for primary agents    //
  // ---------------------------------------------------------------- //

  it('uses ContainerPoolService.acquire for primary agents with workspace path', async () => {
    await service.run(defaultOptions);

    expect(mocks.mockContainerPool.acquire).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-def-1' }),
      'sess-1',
      {
        workspaceHostPath: '/host/data/users/user-1/workspace',
        skillMounts: expect.objectContaining({
          builtinHostPath: expect.any(String),
          customHostPath: expect.any(String),
        }),
      },
    );
    expect(mocks.mockContainerRunner.start).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------- //
  //  Test 17: Uses ContainerPoolService.release in finally for primary //
  // ---------------------------------------------------------------- //

  it('uses ContainerPoolService.release in finally block for primary agents', async () => {
    await service.run(defaultOptions);

    expect(mocks.mockContainerPool.release).toHaveBeenCalledWith('sess-1');
    expect(mocks.mockContainerRunner.stop).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------- //
  //  Test 18: Uses direct ContainerRunner.start/stop for sub-agents   //
  // ---------------------------------------------------------------- //

  it('uses direct ContainerRunner.start/stop for sub-agents with workspace path', async () => {
    await service.run({ ...defaultOptions, isSubAgent: true });

    expect(mocks.mockContainerRunner.start).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-def-1' }),
      [],
      {
        workspaceHostPath: '/host/data/users/user-1/workspace',
        skillMounts: expect.objectContaining({
          builtinHostPath: expect.any(String),
          customHostPath: expect.any(String),
        }),
      },
    );
    expect(mocks.mockContainerRunner.stop).toHaveBeenCalled();
    expect(mocks.mockContainerPool.acquire).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------- //
  //  Test 19: Calls contextBuilder.buildMessages with correct params  //
  // ---------------------------------------------------------------- //

  it('calls contextBuilder.buildMessages with correct params', async () => {
    await service.run(defaultOptions);

    expect(mocks.mockContextBuilder.buildMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDef: expect.objectContaining({ name: 'test-agent' }),
        input: 'Hello!',
        userId: 'user-1',
      }),
    );
  });

  // ---------------------------------------------------------------- //
  //  Test 20: Sub-agents get empty history instead of parent session  //
  // ---------------------------------------------------------------- //

  it('does not load session history for sub-agents', async () => {
    await service.run({ ...defaultOptions, isSubAgent: true });

    expect(mocks.mockSessionManager.loadMessages).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------- //
  //  Test 21: Sub-agents skip session message saves                   //
  // ---------------------------------------------------------------- //

  it('does not save messages to session for sub-agents', async () => {
    await service.run({ ...defaultOptions, isSubAgent: true });

    expect(mocks.mockSessionManager.saveMessages).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------- //
  //  Test 22: Sub-agents pass isSubAgent and no workspacePath to      //
  //           context builder                                         //
  // ---------------------------------------------------------------- //

  it('passes isSubAgent flag and omits workspacePath in context builder for sub-agents', async () => {
    await service.run({ ...defaultOptions, isSubAgent: true });

    expect(mocks.mockContextBuilder.buildMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        isSubAgent: true,
        workspacePath: undefined,
      }),
    );
  });

  // ---------------------------------------------------------------- //
  //  Test 23: Primary agents pass workspacePath and no isSubAgent     //
  // ---------------------------------------------------------------- //

  it('passes workspacePath and undefined isSubAgent for primary agents', async () => {
    await service.run(defaultOptions);

    expect(mocks.mockContextBuilder.buildMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: '/data/users/user-1/workspace',
      }),
    );
    const callArgs = mocks.mockContextBuilder.buildMessages.mock.calls[0]![0];
    expect(callArgs.isSubAgent).toBeUndefined();
  });

  // ---------------------------------------------------------------- //
  //  Test 24: Primary agents load active workers for context builder  //
  // ---------------------------------------------------------------- //

  it('loads active workers and passes them to context builder for primary agents', async () => {
    const workers = [
      { id: 'w1', name: 'researcher', description: 'Searches info', role: 'worker' },
      { id: 'w2', name: 'coder', description: null, role: 'worker' },
    ];
    mocks.mockAgentDefRepo.findActiveWorkers.mockResolvedValue(workers);

    await service.run(defaultOptions);

    expect(mocks.mockAgentDefRepo.findActiveWorkers).toHaveBeenCalledOnce();
    expect(mocks.mockContextBuilder.buildMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        workers: [
          { name: 'researcher', description: 'Searches info' },
          { name: 'coder', description: null },
        ],
      }),
    );
  });

  // ---------------------------------------------------------------- //
  //  Test 25: Sub-agents do not load workers                          //
  // ---------------------------------------------------------------- //

  it('does not load workers for sub-agents', async () => {
    await service.run({ ...defaultOptions, isSubAgent: true });

    expect(mocks.mockAgentDefRepo.findActiveWorkers).not.toHaveBeenCalled();
    expect(mocks.mockContextBuilder.buildMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        workers: undefined,
      }),
    );
  });

  // ---------------------------------------------------------------- //
  //  Test 26: passes agentRunId to createSpawnTool for parent lineage //
  // ---------------------------------------------------------------- //

  it('passes agentRunId to createSpawnTool for parent lineage', async () => {
    await service.run(defaultOptions);

    expect(vi.mocked(createSpawnTool)).toHaveBeenCalledWith(
      expect.anything(), // agentDefRepo
      expect.anything(), // agentRunRepo
      expect.anything(), // taskExecutor
      'sess-1', // parentSessionId
      'run-1', // parentAgentRunId (the current run's ID)
      'user-1', // userId
    );
  });

  // ---------------------------------------------------------------- //
  //  Test 27: Reuses existing session for reinvocation runs           //
  // ---------------------------------------------------------------- //

  it('reuses existing session for reinvocation runs', async () => {
    await service.run({
      ...defaultOptions,
      sessionId: 'sess-existing',
      isReinvocation: true,
    });

    expect(mocks.mockSessionManager.getOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-existing',
      }),
    );
  });

  // ---------------------------------------------------------------- //
  //  Test 28: Creates new AgentRun for reinvocation (not reuse)       //
  // ---------------------------------------------------------------- //

  it('creates new AgentRun for reinvocation (not reuse)', async () => {
    await service.run({
      ...defaultOptions,
      isReinvocation: true,
    });

    // Should call create (new run for token tracking), not update with an existing agentRunId
    expect(mocks.mockAgentRunRepo.create).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------- //
  //  Test 29: Registers spawn tool for reinvocation runs              //
  // ---------------------------------------------------------------- //

  it('registers spawn tool for reinvocation runs', async () => {
    await service.run({
      ...defaultOptions,
      isReinvocation: true,
    });

    expect(vi.mocked(createSpawnTool)).toHaveBeenCalled();
  });
});
