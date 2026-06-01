import { describe, expect, it, vi } from 'vitest';

import { createSpawnTool } from '../tools/spawn.js';
import { BudgetTracker } from '../budget-tracker.js';
import type { AgentDefinitionRepository } from '../../db/agent-definition.repository.js';
import type { AgentRunRepository } from '../../db/agent-run.repository.js';

// Minimal stub shapes — only the methods used by the spawn tool.
function makeAgentDefRepo(overrides?: {
  findByName?: ReturnType<typeof vi.fn>;
  findOrCreateDefaultWorker?: ReturnType<typeof vi.fn>;
}): Pick<AgentDefinitionRepository, 'findByName' | 'findOrCreateDefaultWorker'> {
  return {
    findByName: overrides?.findByName ?? vi.fn().mockResolvedValue(null),
    findOrCreateDefaultWorker:
      overrides?.findOrCreateDefaultWorker ??
      vi.fn().mockResolvedValue({
        id: 'def-default',
        name: 'default-worker',
        role: 'worker',
      }),
  };
}

function makeAgentRunRepo(
  createdRun: Awaited<ReturnType<AgentRunRepository['create']>>,
): Pick<AgentRunRepository, 'create'> {
  return {
    create: vi.fn().mockResolvedValue(createdRun),
  };
}

const defaultRun = {
  id: 'run-456',
  agentDefinitionId: 'def-123',
  sessionId: 'session-abc',
  input: 'Do something',
  status: 'pending' as const,
} as Awaited<ReturnType<AgentRunRepository['create']>>;

describe('spawn tool — metadata', () => {
  it('has the correct tool name', () => {
    const tool = createSpawnTool(
      makeAgentDefRepo() as AgentDefinitionRepository,
      makeAgentRunRepo(defaultRun) as AgentRunRepository,
      null,
      'session-abc',
      'parent-run-0',
      'user-1',
    );

    expect(tool.name).toBe('spawn');
  });

  it('requires only prompt parameter (agent_name is optional)', () => {
    const tool = createSpawnTool(
      makeAgentDefRepo() as AgentDefinitionRepository,
      makeAgentRunRepo(defaultRun) as AgentRunRepository,
      null,
      'session-abc',
      'parent-run-0',
      'user-1',
    );

    expect(tool.parameters.required).toContain('prompt');
    expect(tool.parameters.required).not.toContain('agent_name');
  });
});

describe('spawn tool — named spawn', () => {
  it('queues a pending AgentRun when worker agent is found', async () => {
    const agentDef = { id: 'def-123', name: 'summarizer', role: 'worker', isActive: true };
    const agentDefRepo = makeAgentDefRepo({
      findByName: vi.fn().mockResolvedValue(agentDef),
    });
    const agentRunRepo = makeAgentRunRepo(defaultRun);

    const tool = createSpawnTool(
      agentDefRepo as AgentDefinitionRepository,
      agentRunRepo as AgentRunRepository,
      null,
      'session-abc',
      'parent-run-0',
      'user-1',
    );

    const result = await tool.execute({ agent_name: 'summarizer', prompt: 'Summarize this' });

    expect(result.isError).toBe(false);
    expect(agentRunRepo.create).toHaveBeenCalledOnce();
    expect(agentRunRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ agentDefinitionId: 'def-123', status: 'pending' }),
    );
    expect(result.output).toContain('run-456');
  });

  it('returns error when agent is not found', async () => {
    const agentDefRepo = makeAgentDefRepo({
      findByName: vi.fn().mockResolvedValue(null),
    });
    const agentRunRepo = makeAgentRunRepo(defaultRun);

    const tool = createSpawnTool(
      agentDefRepo as AgentDefinitionRepository,
      agentRunRepo as AgentRunRepository,
      null,
      'session-abc',
      'parent-run-0',
      'user-1',
    );

    const result = await tool.execute({ agent_name: 'unknown-agent', prompt: 'Do something' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('unknown-agent');
    expect(agentRunRepo.create).not.toHaveBeenCalled();
  });

  it('rejects spawning a non-worker agent', async () => {
    const agentDef = { id: 'def-primary', name: 'assistant', role: 'primary', isActive: true };
    const agentDefRepo = makeAgentDefRepo({
      findByName: vi.fn().mockResolvedValue(agentDef),
    });
    const agentRunRepo = makeAgentRunRepo(defaultRun);

    const tool = createSpawnTool(
      agentDefRepo as AgentDefinitionRepository,
      agentRunRepo as AgentRunRepository,
      null,
      'session-abc',
      'parent-run-0',
      'user-1',
    );

    const result = await tool.execute({ agent_name: 'assistant', prompt: 'Do something' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('not a worker agent');
    expect(agentRunRepo.create).not.toHaveBeenCalled();
  });
});

describe('spawn tool — anonymous spawn', () => {
  it('uses default-worker when agent_name is omitted', async () => {
    const defaultWorker = { id: 'def-default', name: 'default-worker', role: 'worker' };
    const agentDefRepo = makeAgentDefRepo({
      findOrCreateDefaultWorker: vi.fn().mockResolvedValue(defaultWorker),
    });
    const agentRunRepo = makeAgentRunRepo(defaultRun);

    const tool = createSpawnTool(
      agentDefRepo as AgentDefinitionRepository,
      agentRunRepo as AgentRunRepository,
      null,
      'session-abc',
      'parent-run-0',
      'user-1',
    );

    const result = await tool.execute({ prompt: 'Do something generic' });

    expect(result.isError).toBe(false);
    expect(agentDefRepo.findOrCreateDefaultWorker).toHaveBeenCalledOnce();
    expect(agentRunRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ agentDefinitionId: 'def-default' }),
    );
    expect(result.output).toContain('default-worker');
  });
});

describe('spawn tool — task executor integration', () => {
  it('calls taskExecutor.submit when executor is provided', async () => {
    const agentDef = { id: 'def-123', name: 'summarizer', role: 'worker', isActive: true };
    const agentDefRepo = makeAgentDefRepo({
      findByName: vi.fn().mockResolvedValue(agentDef),
    });
    const agentRunRepo = makeAgentRunRepo(defaultRun);
    const mockSubmit = vi.fn();

    const tool = createSpawnTool(
      agentDefRepo as AgentDefinitionRepository,
      agentRunRepo as AgentRunRepository,
      { submit: mockSubmit },
      'session-abc',
      'parent-run-0',
      'user-1',
    );

    await tool.execute({ agent_name: 'summarizer', prompt: 'Summarize this' });

    expect(mockSubmit).toHaveBeenCalledOnce();
    expect(mockSubmit).toHaveBeenCalledWith('run-456', {
      agentDefinitionId: 'def-123',
      input: 'Summarize this',
      userId: 'user-1',
      sessionId: 'session-abc',
      displayName: 'summarizer',
    });
  });

  it('persists tokenBudget + tokenGracePercent and forwards tracker when one is supplied', async () => {
    const agentDef = { id: 'def-123', name: 'summarizer', role: 'worker', isActive: true };
    const agentDefRepo = makeAgentDefRepo({
      findByName: vi.fn().mockResolvedValue(agentDef),
    });
    const agentRunRepo = makeAgentRunRepo(defaultRun);
    const mockSubmit = vi.fn();
    const tracker = new BudgetTracker(5000, 25);

    const tool = createSpawnTool(
      agentDefRepo as AgentDefinitionRepository,
      agentRunRepo as AgentRunRepository,
      { submit: mockSubmit },
      'session-abc',
      'parent-run-0',
      'user-1',
      tracker,
    );

    await tool.execute({ agent_name: 'summarizer', prompt: 'Summarize this' });

    // Persisted on the AgentRun row so a recovered orphan can rebuild a tracker.
    expect(agentRunRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ tokenBudget: 5000, tokenGracePercent: 25 }),
    );
    // Forwarded in-memory to the executor for the live (non-recovery) path.
    expect(mockSubmit).toHaveBeenCalledWith(
      'run-456',
      expect.objectContaining({ budgetTracker: tracker }),
    );
  });

  it('omits tokenBudget when tracker has null budget (no enforcement)', async () => {
    const agentDef = { id: 'def-123', name: 'summarizer', role: 'worker', isActive: true };
    const agentDefRepo = makeAgentDefRepo({
      findByName: vi.fn().mockResolvedValue(agentDef),
    });
    const agentRunRepo = makeAgentRunRepo(defaultRun);
    const tracker = new BudgetTracker(null, 10);

    const tool = createSpawnTool(
      agentDefRepo as AgentDefinitionRepository,
      agentRunRepo as AgentRunRepository,
      null,
      'session-abc',
      'parent-run-0',
      'user-1',
      tracker,
    );

    await tool.execute({ agent_name: 'summarizer', prompt: 'Do work' });

    const createCall = (agentRunRepo.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createCall.tokenBudget).toBeUndefined();
    expect(createCall.tokenGracePercent).toBeUndefined();
  });

  it('works without executor (null — stub mode)', async () => {
    const agentDef = { id: 'def-123', name: 'summarizer', role: 'worker', isActive: true };
    const agentDefRepo = makeAgentDefRepo({
      findByName: vi.fn().mockResolvedValue(agentDef),
    });
    const agentRunRepo = makeAgentRunRepo(defaultRun);

    const tool = createSpawnTool(
      agentDefRepo as AgentDefinitionRepository,
      agentRunRepo as AgentRunRepository,
      null,
      'session-abc',
      'parent-run-0',
      'user-1',
    );

    const result = await tool.execute({ agent_name: 'summarizer', prompt: 'Do work' });

    expect(agentRunRepo.create).toHaveBeenCalledOnce();
    expect(result.isError).toBe(false);
  });
});

describe('spawn tool — parentAgentRunId', () => {
  it('stores parentAgentRunId on child AgentRun', async () => {
    const agentDef = { id: 'def-123', name: 'summarizer', role: 'worker', isActive: true };
    const agentDefRepo = makeAgentDefRepo({
      findByName: vi.fn().mockResolvedValue(agentDef),
    });
    const agentRunRepo = makeAgentRunRepo(defaultRun);

    const tool = createSpawnTool(
      agentDefRepo as AgentDefinitionRepository,
      agentRunRepo as AgentRunRepository,
      null,
      'session-abc',
      'parent-run-1',
      'user-1',
    );

    await tool.execute({ agent_name: 'summarizer', prompt: 'Summarize this' });

    expect(agentRunRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parentAgentRunId: 'parent-run-1',
      }),
    );
  });
});

describe('spawn tool — abortSignal propagation', () => {
  it('forwards parent abortSignal via submit options', async () => {
    const agentDef = { id: 'def-123', name: 'summarizer', role: 'worker', isActive: true };
    const agentDefRepo = makeAgentDefRepo({
      findByName: vi.fn().mockResolvedValue(agentDef),
    });
    const agentRunRepo = makeAgentRunRepo(defaultRun);

    let seenSignal: AbortSignal | undefined;
    const fakeTaskExecutor = {
      submit: vi.fn((_id: string, opts: { abortSignal?: AbortSignal }) => {
        seenSignal = opts.abortSignal;
      }),
    };

    const tool = createSpawnTool(
      agentDefRepo as AgentDefinitionRepository,
      agentRunRepo as AgentRunRepository,
      fakeTaskExecutor,
      'session-abc',
      'parent-run-1',
      'user-1',
    );

    const controller = new AbortController();
    await tool.execute(
      { agent_name: 'summarizer', prompt: 'do something' },
      { abortSignal: controller.signal },
    );

    expect(seenSignal).toBe(controller.signal);
  });

  it('does not include abortSignal in submit options when ctx is absent', async () => {
    const agentDef = { id: 'def-123', name: 'summarizer', role: 'worker', isActive: true };
    const agentDefRepo = makeAgentDefRepo({
      findByName: vi.fn().mockResolvedValue(agentDef),
    });
    const agentRunRepo = makeAgentRunRepo(defaultRun);

    const submitArgs: { abortSignal?: AbortSignal }[] = [];
    const fakeTaskExecutor = {
      submit: vi.fn((_id: string, opts: { abortSignal?: AbortSignal }) => {
        submitArgs.push(opts);
      }),
    };

    const tool = createSpawnTool(
      agentDefRepo as AgentDefinitionRepository,
      agentRunRepo as AgentRunRepository,
      fakeTaskExecutor,
      'session-abc',
      'parent-run-1',
      'user-1',
    );

    await tool.execute({ agent_name: 'summarizer', prompt: 'do something' });

    expect(submitArgs[0]).not.toHaveProperty('abortSignal');
  });
});
