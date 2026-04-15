/**
 * AgentRunnerService — top-level NestJS orchestrator that runs a single agent
 * end-to-end, wiring together all Phase 3A-3E components.
 *
 * Lifecycle (21 steps):
 *  1.  Load AgentDefinition, verify isActive
 *  2.  Load user to get policyId
 *  3.  Check budget
 *  4.  Check provider allowed
 *  5.  Get or create session (BEFORE creating AgentRun — FK dependency)
 *  6.  Create AgentRun (or reuse existing via agentRunId) with status 'running'
 *  7.  Load message history
 *  8.  Build initial messages (system + history + user)
 *  9.  Save user message to session
 *  10. Resolve API key from env vars
 *  11. Create LLMProvider via createProvider, wrap with ResilientLLMProvider
 *  12. Start container
 *  13. Create ToolRegistry + registerBuiltinTools + register spawn tool
 *  14. Create ReasoningLoop
 *  15. Run loop
 *  16. Save loop-generated messages (assistant + tool responses)
 *  17. Consolidate session memory via MemoryConsolidationService
 *  18. Record token usage via recordAggregateUsage
 *  19. Update AgentRun to completed
 *  20. Return RunResult
 *
 * Error handling: try/finally around steps 10–19.
 *   finally: always stops container.
 *   catch:   updates AgentRun to failed before re-throwing.
 */

import * as fs from 'fs';
import * as path from 'path';

import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createLogger } from '@clawix/shared';
import type { AgentDefinition as SharedAgentDefinition, ContainerConfig } from '@clawix/shared';

import { PrismaService } from '../prisma/prisma.service.js';
import { MemoryItemRepository } from '../db/memory-item.repository.js';
import { SessionManagerService } from './session-manager.service.js';
import { ContainerRunner } from './container-runner.js';
import { ContainerPoolService } from './container-pool.service.js';
import { TokenCounterService } from './token-counter.service.js';
import { AgentRunRepository } from '../db/agent-run.repository.js';
import { AgentDefinitionRepository } from '../db/agent-definition.repository.js';
import { UserRepository } from '../db/user.repository.js';
import { UserAgentRepository } from '../db/user-agent.repository.js';
import { PolicyRepository } from '../db/policy.repository.js';
import { ChannelRepository } from '../db/channel.repository.js';
import { TaskRepository } from '../db/task.repository.js';
import type { RunOptions, RunResult } from './agent-runner.types.js';
import { ProviderConfigService } from '../provider-config/provider-config.service.js';
import { createProvider } from './providers/provider-factory.js';
import { ResilientLLMProvider } from './resilience.js';
import { MemoryConsolidationService } from './memory-consolidation.service.js';
import { ReasoningLoop } from './reasoning-loop.js';
import { ToolRegistry } from './tool-registry.js';
import { registerBuiltinTools, registerMemoryTools, registerCronTools } from './tools/index.js';
import { createSpawnTool } from './tools/spawn.js';
import { CronGuardService } from './cron-guard.service.js';
import { ContextBuilderService } from './context-builder.service.js';
import { WorkspaceSeederService } from './workspace-seeder.service.js';
import { SearchProviderRegistry } from './tools/web/search-provider.js';
import { registerWebTools } from './tools/web/index.js';
import { resolveWorkspacePaths } from './workspace-resolver.js';
import type { TaskExecutorService } from './task-executor.service.js';

const logger = createLogger('engine:agent-runner');

// ------------------------------------------------------------------ //
//  AgentRunnerService                                                 //
// ------------------------------------------------------------------ //

/**
 * Orchestrates a full agent execution run from input to output.
 *
 * Combines session management, container lifecycle, reasoning loop,
 * tool registration, token accounting, and run record persistence.
 */
@Injectable()
export class AgentRunnerService {
  private taskExecutor_: TaskExecutorService | null = null;

  constructor(
    private readonly sessionManager: SessionManagerService,
    private readonly containerRunner: ContainerRunner,
    private readonly containerPool: ContainerPoolService,
    private readonly tokenCounter: TokenCounterService,
    private readonly agentRunRepo: AgentRunRepository,
    private readonly agentDefRepo: AgentDefinitionRepository,
    private readonly userRepo: UserRepository,
    private readonly userAgentRepo: UserAgentRepository,
    private readonly memoryConsolidation: MemoryConsolidationService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly searchProviderRegistry: SearchProviderRegistry,
    private readonly moduleRef: ModuleRef,
    private readonly prisma: PrismaService,
    private readonly memoryItemRepo: MemoryItemRepository,
    private readonly workspaceSeeder: WorkspaceSeederService,
    private readonly policyRepo: PolicyRepository,
    private readonly channelRepo: ChannelRepository,
    private readonly taskRepo: TaskRepository,
    private readonly cronGuardService: CronGuardService,
    private readonly providerConfig: ProviderConfigService,
  ) {}

  /** Lazy accessor to break circular dependency with TaskExecutorService. */
  private get taskExecutor(): TaskExecutorService {
    if (!this.taskExecutor_) {
      this.taskExecutor_ = this.moduleRef.get('TaskExecutorService', { strict: false });
    }
    return this.taskExecutor_!;
  }

  /**
   * Run an agent from start to finish.
   *
   * @param options - Run configuration (agent ID, input, user ID, optional session).
   * @returns RunResult with the final output, token usage, and run metadata.
   * @throws If the agent is inactive, budget is exceeded, provider is blocked, or API key is missing.
   */
  async run(options: RunOptions): Promise<RunResult> {
    const {
      agentDefinitionId,
      input,
      userId,
      sessionId: inputSessionId,
      onProgress,
      isSubAgent,
      agentRunId: inputAgentRunId,
    } = options;

    // ── Step 1: Load AgentDefinition, verify isActive ──────────────
    const agentDef = await this.agentDefRepo.findById(agentDefinitionId);
    if (!agentDef.isActive) {
      throw new Error(`Agent definition '${agentDefinitionId}' is inactive`);
    }

    logger.info({ agentDefinitionId, userId }, 'Starting agent run');

    // ── Step 2: Load user to get policyId ────────────────────────────
    const user = await this.userRepo.findById(userId);
    const { policyId } = user;
    const policy = await this.policyRepo.findById(policyId);

    // ── Step 3: Check budget ────────────────────────────────────────
    const budget = await this.tokenCounter.checkBudget(userId, policyId);
    if (!budget.allowed) {
      throw new Error(
        `Token budget exceeded for user '${userId}': ` +
          `$${budget.currentUsageUsd.toFixed(4)} used of $${(budget.limitUsd ?? 0).toFixed(4)} budget`,
      );
    }

    // ── Step 4: Check provider allowed ─────────────────────────────
    const providerAllowed = await this.tokenCounter.checkProviderAllowed(
      policyId,
      agentDef.provider,
    );
    if (!providerAllowed) {
      throw new Error(`Provider '${agentDef.provider}' is not allowed by policy '${policyId}'`);
    }

    // ── Step 5: Get or create session ──────────────────────────────
    // Sub-agents always get their own session — never reuse the parent's,
    // which is associated with a different agentDefinitionId.
    const session = await this.sessionManager.getOrCreate({
      userId,
      agentDefinitionId,
      sessionId: isSubAgent ? undefined : inputSessionId,
    });

    // ── Step 6: Create or reuse AgentRun ───────────────────────────
    const agentRun = inputAgentRunId
      ? await this.agentRunRepo.update(inputAgentRunId, {
          status: 'running',
          sessionId: session.id,
        })
      : await this.agentRunRepo.create({
          agentDefinitionId,
          sessionId: session.id,
          input,
          status: 'running',
        });

    logger.info({ agentRunId: agentRun.id, sessionId: session.id }, 'AgentRun created');

    // ── Steps 7–19: Execution block (container + loop) ─────────────
    let containerId: string | null = null;

    try {
      // Step 7: Load message history (sub-agents start with a clean slate)
      const history = isSubAgent ? [] : await this.sessionManager.loadMessages(session.id);

      // Resolve the user's workspace to a host-visible path for the Docker -v flag
      const userAgent = await this.userAgentRepo.findByUserId(userId);
      const workspacePaths = userAgent ? resolveWorkspacePaths(userAgent.workspacePath) : undefined;

      // Step 8: Build enriched messages via ContextBuilder
      // For primary agents, load available worker definitions so the LLM knows what it can spawn
      const workers = isSubAgent
        ? undefined
        : (await this.agentDefRepo.findActiveWorkers()).map((w) => ({
            name: w.name,
            description: w.description,
          }));

      const initialMessages = await this.contextBuilder.buildMessages({
        agentDef,
        history,
        input,
        userId,
        channel: options.channel,
        chatId: options.chatId,
        userName: options.userName,
        workspacePath: isSubAgent ? undefined : workspacePaths?.localPath,
        isSubAgent,
        workers,
      });

      // Step 9: Save user message to session (skip for sub-agents — they don't own the session)
      if (!isSubAgent) {
        await this.sessionManager.saveMessages(session.id, [{ role: 'user', content: input, senderId: userId }]);
      }

      // Step 10: Resolve provider credentials (DB first, env var fallback)
      const resolved = await this.providerConfig.resolveProvider(agentDef.provider);

      // Step 11: Create LLMProvider, wrap with resilience
      const baseProvider = createProvider(
        agentDef.provider,
        resolved.apiKey,
        agentDef.apiBaseUrl ?? resolved.apiBaseUrl ?? undefined,
        agentDef.model,
      );
      const provider = new ResilientLLMProvider(baseProvider);

      // Step 12: Resolve workspace path and acquire container
      // Prisma returns containerConfig as JsonValue; cast to the shared type
      // which is structurally identical at runtime (validated by Zod on write).
      const sharedAgentDef = {
        ...agentDef,
        containerConfig: agentDef.containerConfig as unknown as ContainerConfig,
      } as SharedAgentDefinition;

      // Ensure the local workspace directory exists and is writable by the
      // container user (1000:1000) so the agent process can write to /workspace.
      // Files uploaded via UI or created manually are owned by the host user,
      // so we use chmod to make them world-writable (acceptable for single-org self-hosted).
      if (workspacePaths !== undefined) {
        await fs.promises.mkdir(workspacePaths.localPath, { recursive: true });
        await this.makeWorkspaceWritable(workspacePaths.localPath);
      }

      // Seed bootstrap files (SOUL.md, USER.md) and MEMORY.md if they don't exist yet
      if (workspacePaths !== undefined) {
        const userForSeeding = await this.userRepo.findById(userId);

        // Fetch existing non-daily memory items for seeding
        const existingItems = await this.memoryItemRepo.findVisibleToUser(userId);
        const nonDailyItems = existingItems.filter(
          (item) => !item.tags.some((t) => t.startsWith('daily:')),
        );

        await this.workspaceSeeder.seedWorkspace({
          workspacePath: workspacePaths.localPath,
          templateVars: { 'user.name': userForSeeding.name },
          existingMemoryItems: nonDailyItems,
        });
      }

      // Compute skill mount paths (same local/host duality as workspace-resolver.ts)
      const skillsBuiltinLocalDir =
        process.env['SKILLS_BUILTIN_DIR'] ?? path.resolve(process.cwd(), '../../skills/builtin');
      const skillsBuiltinHostDir = process.env['SKILLS_BUILTIN_HOST_DIR'] ?? skillsBuiltinLocalDir;

      const skillsCustomLocalBase =
        process.env['SKILLS_CUSTOM_DIR'] ??
        path.resolve(process.env['WORKSPACE_BASE_PATH'] ?? './data', 'skills/custom');
      const skillsCustomHostBase =
        process.env['SKILLS_CUSTOM_HOST_DIR'] ??
        path.resolve(process.env['WORKSPACE_HOST_BASE_PATH'] ?? skillsCustomLocalBase);

      const skillsCustomUserLocalDir = path.join(skillsCustomLocalBase, userId);
      const skillsCustomUserHostDir = path.join(skillsCustomHostBase, userId);

      // Ensure user's custom skills directory exists and is writable by container user (1000:1000)
      await fs.promises.mkdir(skillsCustomUserLocalDir, { recursive: true });
      await this.makeWorkspaceWritable(skillsCustomUserLocalDir);

      const skillMounts = {
        builtinHostPath: skillsBuiltinHostDir,
        customHostPath: skillsCustomUserHostDir,
      };

      if (isSubAgent) {
        containerId = await this.containerRunner.start(sharedAgentDef, [], {
          workspaceHostPath: workspacePaths?.hostPath,
          skillMounts,
        });
      } else {
        containerId = await this.containerPool.acquire(sharedAgentDef, session.id, {
          workspaceHostPath: workspacePaths?.hostPath,
          skillMounts,
        });
      }

      // Step 13: Create ToolRegistry, register builtin tools + web tools + memory tools + spawn tool
      const registry = new ToolRegistry();
      registerBuiltinTools(registry, containerId, this.containerRunner);
      registerWebTools(registry, this.searchProviderRegistry);
      registerMemoryTools(registry, this.prisma, this.memoryItemRepo, userId);
      if (!isSubAgent) {
        registry.register(
          createSpawnTool(
            this.agentDefRepo,
            this.agentRunRepo,
            this.taskExecutor,
            session.id,
            agentRun.id,
            userId,
          ),
        );
      }

      // Register cron tools (gated by policy.cronEnabled)
      registerCronTools(
        registry,
        this.cronGuardService,
        this.taskRepo,
        this.channelRepo,
        userId,
        agentDefinitionId,
        {
          cronEnabled: policy.cronEnabled,
          maxScheduledTasks: policy.maxScheduledTasks,
          minCronIntervalSecs: policy.minCronIntervalSecs,
          maxTokensPerCronRun: policy.maxTokensPerCronRun,
        },
        options.isScheduledTask ?? false,
        session.channelId ?? null,
      );

      // Step 14: Create ReasoningLoop
      const loop = new ReasoningLoop(provider, registry);

      // Step 15: Run loop
      // No default wall-clock timeout — let the model finish. The stale run reaper (10 min) is the safety net.
      const timeoutMs = options.timeoutMs;

      logger.info({ agentRunId: agentRun.id }, 'Starting reasoning loop');
      const loopResult = await loop.run(initialMessages, {
        model: agentDef.model,
        onProgress,
        tokenBudget: options.tokenBudget,
        tokenGracePercent: options.tokenGracePercent,
        timeoutMs,
      });

      // Step 16: Save loop-generated messages (skip for sub-agents — they don't own the session)
      let responseMessageId: string | undefined;
      if (!isSubAgent) {
        const loopMessages = loopResult.messages.slice(initialMessages.length);
        if (loopMessages.length > 0) {
          const savedIds = await this.sessionManager.saveMessages(session.id, loopMessages);
          // Find the ID of the last assistant message for WebSocket delivery
          for (let i = loopMessages.length - 1; i >= 0; i--) {
            if (loopMessages[i]!.role === 'assistant') {
              responseMessageId = savedIds[i];
              break;
            }
          }
        }
      }

      // Step 17: Consolidate session memory (primary agents only)
      let contextWarning = '';
      if (!isSubAgent) {
        await this.memoryConsolidation.consolidateIfNeeded(session.id, {
          containerId,
          containerRunner: this.containerRunner,
          agentRunId: agentRun.id,
          userId,
        });

        // Step 17b: Check token warning state
        const warningState = await this.memoryConsolidation.getTokenWarningState(session.id);
        contextWarning =
          warningState.warning === 'critical'
            ? '\n\n---\nSession context is nearly full. Run /compact to free space.'
            : warningState.warning === 'approaching'
              ? '\n\n---\nSession context is getting large. Consider running /compact.'
              : '';
      }

      // Step 18: Record token usage
      await this.tokenCounter.recordAggregateUsage({
        usage: loopResult.totalUsage,
        agentRunId: agentRun.id,
        userId,
        providerName: agentDef.provider,
        model: agentDef.model,
      });

      // Step 19: Update AgentRun to completed (or failed if timeout/token budget was hit)
      const runStatus = loopResult.hitTimeout
        ? 'failed'
        : loopResult.hitTokenBudget
          ? 'failed'
          : 'completed';

      const timeoutSuffix = loopResult.hitTimeout
        ? '\n\n---\nAgent run timed out. Try a simpler request or break it into smaller tasks.'
        : '';

      const finalOutput = ((loopResult.content ?? '') + contextWarning + timeoutSuffix) || null;
      await this.agentRunRepo.update(agentRun.id, {
        status: runStatus,
        output: finalOutput ?? '',
        completedAt: new Date(),
        ...(loopResult.hitTimeout ? { error: 'Agent run timed out' } : {}),
      });

      logger.info(
        { agentRunId: agentRun.id, iterations: loopResult.iterations, runStatus },
        'Agent run completed',
      );

      // Step 20: Return RunResult
      return {
        agentRunId: agentRun.id,
        sessionId: session.id,
        output: finalOutput,
        status: runStatus,
        responseMessageId,
        tokenUsage: {
          inputTokens: loopResult.totalUsage.inputTokens,
          outputTokens: loopResult.totalUsage.outputTokens,
          totalTokens: loopResult.totalUsage.totalTokens,
          model: agentDef.model,
          estimatedCostUsd: 0, // actual cost tracked by tokenCounter
        },
        ...(loopResult.hitTokenBudget ? { error: 'token_budget_exceeded' } : {}),
        ...(loopResult.hitTimeout ? { error: 'Agent run timed out' } : {}),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ agentRunId: agentRun.id, error: message }, 'Agent run failed');

      // Update AgentRun to failed
      await this.agentRunRepo.update(agentRun.id, {
        status: 'failed',
        error: message,
        completedAt: new Date(),
      });

      // Evict from pool on error (primary agents only)
      if (!isSubAgent && containerId !== null) {
        await this.containerPool.evict(session.id);
      }

      throw err;
    } finally {
      if (isSubAgent && containerId !== null) {
        await this.containerRunner.stop(containerId);
      } else if (!isSubAgent) {
        this.containerPool.release(session.id);
      }
    }
  }

  /**
   * Make workspace directory recursively writable by all users.
   * This ensures the container user (1000:1000) can write to files
   * created by the host user (uploads, manual creation).
   */
  private async makeWorkspaceWritable(workspacePath: string): Promise<void> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      // chmod -R a+rwX makes all files/dirs readable and writable by all users
      // Capital X adds execute for directories (needed for traversal) but not files
      // This is acceptable for single-org self-hosted deployments
      await execAsync(`chmod -R a+rwX "${workspacePath}"`);
      logger.debug({ path: workspacePath }, 'Workspace made writable');
    } catch (err: unknown) {
      // chmod may fail on some filesystems or if permissions are restricted
      const message = err instanceof Error ? err.message : String(err);
      logger.debug({ path: workspacePath, error: message }, 'chmod failed, continuing anyway');
    }
  }
}
