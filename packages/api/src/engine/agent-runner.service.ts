/**
 * AgentRunnerService — top-level NestJS orchestrator that runs a single agent
 * end-to-end, wiring together all Phase 3A-3E components.
 *
 * Lifecycle (22 steps):
 *  1.  Load AgentDefinition, verify isActive
 *  2.  Load user to get policyId
 *  3.  Check budget
 *  4.  Check provider allowed
 *  5.  Resolve MessageStore — session path: get/create Session + SessionMessageStore; cron path: use caller-supplied store (no Session).
 *  6.  Create AgentRun (or reuse existing via agentRunId) with status 'running'
 *  6b. Register localController in AgentRunRegistry; build effectiveSignal via AbortSignal.any
 *  7.  Load message history
 *  8.  Build initial messages (system + history + user)
 *  9.  Save user message to session
 *  10. Resolve API key from env vars
 *  11. Create LLMProvider via createProvider — recovery is handled inside ReasoningLoop
 *  12. Start container
 *  13. Create ToolRegistry + registerBuiltinTools + register spawn/cron/browser/python/MCP tools
 *  14. Create ReasoningLoop
 *  15. Run loop (with effectiveSignal so parent cancellations propagate)
 *  16. Save loop-generated messages (assistant + tool responses)
 *  17. Consolidate session memory via MemoryConsolidationService
 *  18. Record token usage via recordAggregateUsage
 *  19. Update AgentRun to completed
 *  20. Return RunResult
 *
 * Cancellation: AgentRun is registered with AgentRunRegistry after step 6.
 *   On user-cancel (signal aborted with reason 'user_stop'), the run returns
 *   early with status='cancelled' from either the post-loop branch or the
 *   catch block, recording any partial token usage (spec D6). The registry's
 *   abortAllForUser() writes 'cancelled' to the DB row directly; the run's
 *   own update is conditional on status='running' to avoid clobbering it.
 *   Sub-agents inherit cancellation only when the parent signal's reason is
 *   'user_stop' — other parent abort reasons (e.g. timeout) do not trigger
 *   the cancelled-status path and fall through to normal error handling.
 *
 * Error handling: try/finally around steps 10–19.
 *   finally: always stops container and unregisters from AgentRunRegistry.
 *   catch:   if user cancelled (reason='user_stop'), returns early with
 *            status='cancelled' and records partial token usage. Otherwise
 *            updates AgentRun to failed before re-throwing.
 */

import * as fs from 'fs';
import * as path from 'path';

import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createLogger } from '@clawix/shared';
import type { AgentDefinition as SharedAgentDefinition, ContainerConfig } from '@clawix/shared';

import { PrismaService } from '../prisma/prisma.service.js';
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
import { TaskRunRepository } from '../db/task-run.repository.js';
import { TaskRunMessageRepository } from '../db/task-run-message.repository.js';
import type { RunOptions, RunResult } from './agent-runner.types.js';
import { SessionMessageStore } from './message-store/session-message-store.js';
import type { MessageStore } from './message-store/message-store.js';
import { computeHiddenInHistory } from './history-visibility.js';
import type { Session } from '../generated/prisma/client.js';
import { ProviderConfigService } from '../provider-config/provider-config.service.js';
import { createProvider } from './providers/provider-factory.js';
import { MemoryConsolidationService } from './memory-consolidation.service.js';
import { ReasoningLoop } from './reasoning-loop.js';
import { CompressorService } from './compressor.js';
import { BudgetTracker } from './budget-tracker.js';
import { ToolRegistry } from './tool-registry.js';
import { registerBuiltinTools, registerCronTools } from './tools/index.js';
import { createSpawnTool } from './tools/spawn.js';
import { CronGuardService } from './cron-guard.service.js';
import { ContextBuilderService } from './context-builder.service.js';
import { WorkspaceSeederService } from './workspace-seeder.service.js';
import { SearchProviderRegistry } from './tools/web/search-provider.js';
import { registerWebTools } from './tools/web/index.js';
import { BrowserSessionManager } from './tools/browser/browser-session-manager.js';
import { BrowserProviderRegistry } from './tools/browser/browser-provider-registry.js';
import { BrowserQuotaCache } from './tools/browser/browser-quota-cache.service.js';
import { registerBrowserTools } from './tools/browser/tools/index.js';
import { resolveVisionConfig } from './tools/browser/vision-config-resolver.js';
import type { RunContext } from './tools/browser/tools/browser-navigate.js';
import { resolveWorkspacePaths } from './workspace-resolver.js';
import type { TaskExecutorService } from './task-executor.service.js';
import { SystemSettingsService } from '../system-settings/system-settings.service.js';
import { AgentRunRegistry } from './agent-run-registry.service.js';
import { PythonContainerPoolService } from './python-container-pool.service.js';
import { PythonProxyHealthService } from './python-proxy-health.service.js';
import { PythonConcurrencyLimiter } from './tools/python/concurrency-limiter.js';
import { InstallMutex } from './tools/python/install-mutex.js';
import { createPythonRunTool } from './tools/python/python-run.js';
import { createPythonRunNetTool } from './tools/python/python-run-net.js';
import { WikiPageRepository } from '../db/wiki-page.repository.js';
import { WikiLinkRepository } from '../db/wiki-link.repository.js';
import { WikiShareRepository } from '../db/wiki-share.repository.js';
import { WikiSearchRepository } from '../db/wiki-search.repository.js';
import { AuditLogRepository } from '../db/audit-log.repository.js';
import { McpServerRepository, type McpServerForRun } from '../db/mcp-server.repository.js';
import { NotificationRepository } from '../db/notification.repository.js';
import { McpClientService } from '../mcp/mcp-client.service.js';
import { McpTokenManager } from '../mcp/mcp-token-manager.service.js';
import { McpRunConnections } from './tools/mcp/mcp-run-connections.js';
import { registerMcpTools } from './tools/mcp/mcp-tool.factory.js';
import { registerWikiTools } from './tools/wiki/register.js';
import { registerSessionTools } from './tools/session/register.js';
import { SessionSearchService } from './session-recall/session-search.service.js';
import { mcpBindingsSchema, type McpBindings } from '@clawix/shared';
import { bindingsFromTiers } from './tools/mcp/bindings-from-tiers.js';

const logger = createLogger('engine:agent-runner');

/**
 * Returns true when the signal was aborted by a user-initiated stop.
 *
 * 'user_stop' is the sole discriminator for the cancelled-status path (spec D6).
 * Non-user-stop abort reasons (e.g. parent timeout) fall through to normal
 * error handling so the run is recorded as 'failed', not 'cancelled'.
 */
function isCancelled(signal: AbortSignal): boolean {
  return signal.aborted && signal.reason === 'user_stop';
}

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
    private readonly workspaceSeeder: WorkspaceSeederService,
    private readonly policyRepo: PolicyRepository,
    private readonly channelRepo: ChannelRepository,
    private readonly taskRepo: TaskRepository,
    private readonly cronGuardService: CronGuardService,
    private readonly providerConfig: ProviderConfigService,
    private readonly taskRunRepo: TaskRunRepository,
    private readonly taskRunMessageRepo: TaskRunMessageRepository,
    private readonly systemSettingsService: SystemSettingsService,
    private readonly compressor: CompressorService,
    private readonly browserSessionManager: BrowserSessionManager,
    private readonly browserProviderRegistry: BrowserProviderRegistry,
    private readonly browserQuotaCache: BrowserQuotaCache,
    private readonly agentRunRegistry: AgentRunRegistry,
    private readonly pythonPool: PythonContainerPoolService,
    private readonly pythonProxyHealth: PythonProxyHealthService,
    private readonly pythonLimiter: PythonConcurrencyLimiter,
    private readonly pythonInstallMutex: InstallMutex,
    private readonly wikiPageRepo: WikiPageRepository,
    private readonly wikiLinkRepo: WikiLinkRepository,
    private readonly wikiShareRepo: WikiShareRepository,
    private readonly wikiSearchRepo: WikiSearchRepository,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly sessionSearchService: SessionSearchService,
    private readonly mcpServerRepo: McpServerRepository,
    private readonly notificationRepo: NotificationRepository,
    private readonly mcpClientService: McpClientService,
    private readonly mcpTokenManager: McpTokenManager,
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

    // Resolve the shared budget tracker:
    //  - sub-agent path: inherit the parent's tracker so all spawned work
    //    accumulates against the same run-wide ceiling.
    //  - primary path with tokenBudget: create a fresh tracker.
    //  - tokenBudget null/omitted: no enforcement.
    const budgetTracker: BudgetTracker | undefined =
      options.budgetTracker ??
      (options.tokenBudget != null
        ? new BudgetTracker(options.tokenBudget, options.tokenGracePercent ?? 10)
        : undefined);

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

    // ── Step 5: Resolve MessageStore ───────────────────────────────
    // When a caller-supplied store is provided (e.g. cron task runner),
    // skip session creation entirely. Otherwise fall back to the normal
    // session-based path, wrapping it in a SessionMessageStore.
    let store: MessageStore;
    let session: Session | null = null;
    if (options.messageStore) {
      store = options.messageStore;
    } else {
      // Sub-agents always get their own session — never reuse the parent's,
      // which is associated with a different agentDefinitionId.
      session = await this.sessionManager.getOrCreate({
        userId,
        agentDefinitionId,
        sessionId: isSubAgent ? undefined : inputSessionId,
        ...(!isSubAgent && options.channelId ? { channelId: options.channelId } : {}),
      });
      store = new SessionMessageStore(this.sessionManager, session.id);
    }

    // ── Step 6: Create or reuse AgentRun ───────────────────────────
    const agentRun = inputAgentRunId
      ? await this.agentRunRepo.update(inputAgentRunId, {
          status: 'running',
          ...(session ? { sessionId: session.id } : {}),
        })
      : await this.agentRunRepo.create({
          agentDefinitionId,
          ...(session ? { sessionId: session.id } : {}),
          input,
          status: 'running',
        });

    logger.info({ agentRunId: agentRun.id, sessionId: session?.id ?? null }, 'AgentRun created');

    // Build the cancellation controller and an effective abort signal.
    //
    // localController is registered in the registry so the stop endpoint can
    // abort it directly. effectiveSignal merges localController.signal with any
    // caller-supplied parent signal (e.g. sub-agent inheriting parent cancel)
    // using AbortSignal.any — this avoids a listener leak that would occur with
    // addEventListener when the local controller aborts before the parent does.
    //
    // Cancellation discriminator: we only enter the 'cancelled' status path when
    // effectiveSignal.reason === 'user_stop'. This is intentional:
    //  - Stop endpoint calls registry.abort(runId, 'user_stop')
    //  - Sub-agents inherit cancellation only when the parent's reason is 'user_stop'
    //  - Non-user-stop parent reasons (e.g. a parent timeout) do NOT trigger the
    //    cancelled-status path; they fall through to normal error handling (failed).
    const localController = new AbortController();
    const signals: AbortSignal[] = [localController.signal];
    if (options.abortSignal) signals.push(options.abortSignal);
    const effectiveSignal = signals.length > 1 ? AbortSignal.any(signals) : localController.signal;

    this.agentRunRegistry.register(agentRun.id, localController);

    // ── Steps 7–19: Execution block (container + loop) ─────────────
    let containerId: string | null = null;
    // Pool is only meaningful when a session exists to key the warm container.
    const usePool = !isSubAgent && session !== null;
    // Hoisted so the finally block can close any opened MCP connections.
    let mcpConnections: McpRunConnections | undefined;

    try {
      // Step 7: Load message history (sub-agents start with a clean slate)
      const history = isSubAgent ? [] : await store.loadMessages();

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

      const { messages: initialMessages, stalenessMap } = await this.contextBuilder.buildMessages({
        agentDef,
        history,
        input,
        userId,
        channel: options.channel,
        chatId: options.chatId,
        userName: options.userName,
        replyContext: options.replyContext,
        workspacePath: isSubAgent ? undefined : workspacePaths?.localPath,
        isSubAgent,
        isScheduledTask: options.isScheduledTask,
        workers,
        session: session
          ? { id: session.id, cachedSystemPrompt: session.cachedSystemPrompt }
          : undefined,
      });

      // Step 9: Save user message to store (skip for sub-agents — they don't own the session)
      if (!isSubAgent) {
        await store.saveMessages([{ role: 'user', content: input, senderId: userId }]);
      }

      // Step 10: Resolve provider credentials (DB first, env var fallback)
      const resolved = await this.providerConfig.resolveProvider(agentDef.provider);

      // Step 11: Create LLMProvider
      const provider = createProvider(
        agentDef.provider,
        resolved.apiKey,
        agentDef.apiBaseUrl ?? resolved.apiBaseUrl ?? undefined,
        agentDef.model,
      );

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

      // Seed bootstrap files (SOUL.md, USER.md) if they don't exist yet
      if (workspacePaths !== undefined) {
        const userForSeeding = await this.userRepo.findById(userId);

        await this.workspaceSeeder.seedWorkspace({
          workspacePath: workspacePaths.localPath,
          templateVars: { 'user.name': userForSeeding.name },
        });
      }

      // REMOVE AFTER 2026-Q3 MIGRATION COMPLETE — auto-migrates legacy custom-skill location
      // into <workspace>/skills/. See docs/specs/2026-04-29-custom-skills-in-workspace-design.md.
      if (workspacePaths !== undefined) {
        const legacyDir = path.resolve(
          process.env['WORKSPACE_BASE_PATH'] ?? './data',
          'skills/custom',
          userId,
        );
        const legacyEntries = await fs.promises.readdir(legacyDir).catch(() => null);
        if (legacyEntries && legacyEntries.length > 0) {
          const targetSkillsDir = path.join(workspacePaths.localPath, 'skills');
          await fs.promises.mkdir(targetSkillsDir, { recursive: true });
          for (const name of legacyEntries) {
            const source = path.join(legacyDir, name);
            const target = path.join(targetSkillsDir, name);
            const exists = await fs.promises
              .stat(target)
              .then(() => true)
              .catch(() => false);
            if (exists) {
              logger.warn(
                { userId, name },
                'Skill collision during lazy migration — leaving source in place',
              );
              continue;
            }
            try {
              await fs.promises.rename(source, target);
              logger.info({ userId, name }, 'Lazy-migrated legacy custom skill into workspace');
            } catch (err) {
              // ENOENT: another concurrent agent run for the same user already moved this skill.
              // Treat as success and continue.
              if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                continue;
              }
              throw err;
            }
          }
          await fs.promises.rmdir(legacyDir).catch(() => undefined);
        }
      }

      // Compute builtin skill mount paths (same local/host duality as workspace-resolver.ts).
      // Custom skills now live inside the workspace at <workspace>/skills/, so they ride along
      // on the workspace mount and don't need a separate -v flag.
      const skillsBuiltinLocalDir =
        process.env['SKILLS_BUILTIN_DIR'] ?? path.resolve(process.cwd(), '../../skills/builtin');
      const skillsBuiltinHostDir = process.env['SKILLS_BUILTIN_HOST_DIR'] ?? skillsBuiltinLocalDir;

      // Ensure <workspace>/skills exists so the loader scan finds it
      if (workspacePaths !== undefined) {
        await fs.promises.mkdir(path.join(workspacePaths.localPath, 'skills'), { recursive: true });
      }

      const skillMounts = { builtinHostPath: skillsBuiltinHostDir };

      if (!usePool) {
        containerId = await this.containerRunner.start(sharedAgentDef, [], {
          workspaceHostPath: workspacePaths?.hostPath,
          skillMounts,
        });
      } else {
        containerId = await this.containerPool.acquire(sharedAgentDef, session!.id, {
          workspaceHostPath: workspacePaths?.hostPath,
          skillMounts,
        });
      }

      // Step 13: Create ToolRegistry, register builtin tools + web tools + memory/wiki tools + spawn tool
      const registry = new ToolRegistry();
      registerBuiltinTools(registry, containerId, this.containerRunner);
      registerWebTools(registry, this.searchProviderRegistry);

      // Memory toolset: wiki-backed tools.
      const lintEnabled = (policy as { wikiLintEnabled?: boolean })?.wikiLintEnabled ?? true;
      registerWikiTools(
        registry,
        {
          prisma: this.prisma,
          pages: this.wikiPageRepo,
          links: this.wikiLinkRepo,
          shares: this.wikiShareRepo,
          search: this.wikiSearchRepo,
          audit: this.auditLogRepo,
          users: this.userRepo,
          policies: this.policyRepo,
        },
        userId,
        { lintEnabled },
      );

      // Session recall: search the user's own past conversations.
      registerSessionTools(registry, { searchService: this.sessionSearchService }, userId);

      if (!isSubAgent && session) {
        registry.register(
          createSpawnTool(
            this.agentDefRepo,
            this.agentRunRepo,
            this.taskExecutor,
            session.id,
            agentRun.id,
            userId,
            budgetTracker,
            policy.maxSubAgentRunMs,
          ),
        );
      }

      // Register cron tools (gated by policy.cronEnabled)
      const settings = await this.systemSettingsService.get();
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
        session?.channelId ?? null,
        this.taskRunRepo,
        this.taskRunMessageRepo,
        settings.defaultTimezone,
      );

      // Step 13b: Wire browser tools (gated by BrowserProviderRegistry.getActive())
      await this.browserQuotaCache.warm(userId);
      const resolvedApiKey = resolved.apiKey;
      const resolvedApiBaseUrl = agentDef.apiBaseUrl ?? resolved.apiBaseUrl ?? undefined;
      const visionConfig = await resolveVisionConfig(
        {
          findAgentById: (id) => this.agentDefRepo.findById(id),
          resolveProvider: (name) => this.providerConfig.resolveProvider(name),
        },
        {
          agentDef,
          resolvedApiKey,
          resolvedApiBaseUrl,
          policy,
          budgetTracker,
        },
      );
      const getRunContext = (): RunContext => ({
        runId: agentRun.id,
        userId,
        activeModel: agentDef.model,
        toolConfig: (agentDef.toolConfig ?? {}) as RunContext['toolConfig'],
        policy: { allowBrowserCdp: policy.allowBrowserCdp },
        vision: visionConfig,
      });
      registerBrowserTools(
        registry,
        this.browserProviderRegistry,
        this.browserSessionManager,
        getRunContext,
      );

      // Step 13c: Wire python tools (gated by policy.allowPython / allowPythonNet)
      const pythonPolicy = {
        allowPython: policy.allowPython,
        allowPythonNet: policy.allowPythonNet,
        pythonPackageAllowlist: policy.pythonPackageAllowlist,
        maxPythonMemoryMb: policy.maxPythonMemoryMb,
        maxPythonTimeoutSecs: policy.maxPythonTimeoutSecs,
        maxPythonCpuCores: policy.maxPythonCpuCores,
        maxConcurrentPythonRuns: policy.maxConcurrentPythonRuns,
      };

      if (policy.allowPython && workspacePaths !== undefined) {
        registry.register(
          createPythonRunTool({
            sessionId: session?.id ?? `agentrun-${agentRun.id}`,
            userId,
            workspaceHostPath: workspacePaths.hostPath,
            policy: pythonPolicy,
            pool: this.pythonPool,
            runner: this.containerRunner,
            proxyHealth: this.pythonProxyHealth,
            limiter: this.pythonLimiter,
            installMutex: this.pythonInstallMutex,
          }),
        );
      }

      if (policy.allowPythonNet && workspacePaths !== undefined) {
        registry.register(
          createPythonRunNetTool({
            userId,
            workspaceHostPath: workspacePaths.hostPath,
            policy: pythonPolicy,
            runner: this.containerRunner,
            proxyHealth: this.pythonProxyHealth,
            limiter: this.pythonLimiter,
            installMutex: this.pythonInstallMutex,
          }),
        );
      }

      // Step 13d: Wire MCP tools (gated by policy.allowMcp + per-agent bindings).
      // Registration is zero-network: wrappers come from the cached McpTool
      // catalog + the caller's McpConnection; connections open lazily on the
      // first actual call.
      mcpConnections = new McpRunConnections(this.mcpClientService, undefined, {
        tokenManager: this.mcpTokenManager,
        userId,
      });
      if (policy.allowMcp) {
        // Override: an explicit per-agent allowlist wins (TOFU, power users /
        // narrow sub-agents). Empty/absent binding → auto path: every server
        // the user has an active connection to contributes its `recommended`
        // tier, so public agents get the user's curated tools with no Save.
        const override = mcpBindingsSchema.safeParse(
          ((agentDef.toolConfig ?? {}) as { mcp?: unknown }).mcp ?? {},
        );

        let mcpServers: readonly McpServerForRun[];
        let bindings: McpBindings;
        if (override.success && override.data.servers.length > 0) {
          mcpServers = await this.mcpServerRepo.findServersForRun(
            override.data.servers.map((b) => b.serverId),
            userId,
          );
          bindings = override.data;
        } else {
          mcpServers = await this.mcpServerRepo.findEnabledServersForUser(userId);
          bindings = bindingsFromTiers(mcpServers);
        }

        if (bindings.servers.length > 0) {
          await registerMcpTools(registry, {
            servers: mcpServers,
            bindings,
            connections: mcpConnections,
            audit: this.auditLogRepo,
            notifications: this.notificationRepo,
            userId,
            agentRunId: agentRun.id,
          });
        }
      }

      // Step 14: Create ReasoningLoop
      const loop = new ReasoningLoop(provider, registry, this.compressor, {
        provider: agentDef.provider,
        model: agentDef.model,
      });

      // Step 15: Run loop
      // Sub-agents always carry a policy-resolved timeout (supplied by the
      // TaskExecutorService); primary runs have none by default and let the
      // model finish, with the stale-run reaper (10 min) as their backstop.
      const timeoutMs = options.timeoutMs;

      // Wire the streaming event sink only for primary runs of agents that
      // opted into streaming. Sub-agents stay silent (their output is
      // consumed by the parent, not the user). Without the agent flag,
      // legacy non-streaming behavior is preserved.
      const streamingUsed = !isSubAgent && !!agentDef.streamingEnabled && options.onEvent != null;

      logger.info({ agentRunId: agentRun.id, streamingUsed }, 'Starting reasoning loop');
      const loopResult = await loop.run(initialMessages, {
        model: agentDef.model,
        onProgress,
        ...(budgetTracker ? { budgetTracker } : {}),
        timeoutMs,
        ...(streamingUsed && options.onEvent ? { onEvent: options.onEvent } : {}),
        abortSignal: effectiveSignal,
        stalenessMap,
      });

      // Detect user cancellation — abort endpoint already wrote status='cancelled'.
      // Record any token usage that accumulated before the abort (spec D6),
      // then return early without overwriting the DB status.
      if (isCancelled(effectiveSignal)) {
        await this.tokenCounter.recordAggregateUsage({
          usage: loopResult.totalUsage,
          agentRunId: agentRun.id,
          userId,
          providerName: agentDef.provider,
          model: agentDef.model,
        });
        logger.info({ agentRunId: agentRun.id }, 'Agent run cancelled by user');
        return {
          agentRunId: agentRun.id,
          sessionId: session?.id ?? null,
          output: null,
          status: 'cancelled',
          streamingUsed,
          tokenUsage: {
            inputTokens: loopResult.totalUsage.inputTokens,
            outputTokens: loopResult.totalUsage.outputTokens,
            totalTokens: loopResult.totalUsage.totalTokens,
            model: agentDef.model,
            estimatedCostUsd: 0,
          },
        };
      }

      // Step 16: Save loop-generated messages (skip for sub-agents — they don't own the session)
      let responseMessageId: string | undefined;
      if (!isSubAgent) {
        const loopMessages = loopResult.messages.slice(initialMessages.length);
        if (loopMessages.length > 0) {
          // Non-streamed runs only showed the user one combined final reply, so
          // hide the intermediate reasoning steps from history to match. Streamed
          // runs surfaced every step live, so all stay visible.
          const hiddenInHistory = computeHiddenInHistory(loopMessages, streamingUsed);
          const savedIds = await store.saveMessages(loopMessages, { hiddenInHistory });
          // Find the ID of the last assistant message for WebSocket delivery
          for (let i = loopMessages.length - 1; i >= 0; i--) {
            if (loopMessages[i]!.role === 'assistant') {
              responseMessageId = savedIds[i];
              break;
            }
          }
        }
      }

      // Step 17: Consolidate session memory (primary agents with a real session only)
      let contextWarning = '';
      if (!isSubAgent && session) {
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

      const transcriptOutput =
        options.outputMode === 'fullTranscript'
          ? loopResult.messages
              .filter((m) => m.role === 'assistant')
              .map((m) => m.content)
              .filter((c) => c.trim().length > 0)
              .join('\n\n')
          : (loopResult.content ?? '');

      const finalOutput = transcriptOutput + contextWarning + timeoutSuffix || null;
      await this.prisma.agentRun.updateMany({
        where: { id: agentRun.id, status: 'running' },
        data: {
          status: runStatus,
          output: finalOutput ?? '',
          completedAt: new Date(),
          ...(loopResult.hitTimeout ? { error: 'Agent run timed out' } : {}),
        },
      });

      logger.info(
        { agentRunId: agentRun.id, iterations: loopResult.iterations, runStatus },
        'Agent run completed',
      );

      // Step 20: Return RunResult
      return {
        agentRunId: agentRun.id,
        sessionId: session?.id ?? null,
        output: finalOutput,
        status: runStatus,
        responseMessageId,
        streamingUsed,
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
      // Check for user cancellation first — the stop endpoint already wrote
      // status='cancelled', so we must not overwrite with 'failed'.
      if (isCancelled(effectiveSignal)) {
        // Spec D6: record what was actually consumed, even on cancel.
        // loopResult is unavailable here (loop threw), so we record zero usage.
        // Any usage captured on internal mutator paths before the throw has
        // already been flushed; this call ensures the pipeline is always invoked.
        await this.tokenCounter
          .recordAggregateUsage({
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            agentRunId: agentRun.id,
            userId,
            providerName: agentDef.provider,
            model: agentDef.model,
          })
          .catch((e) => logger.warn({ err: e }, 'recordAggregateUsage on cancel failed'));
        logger.info({ agentRunId: agentRun.id }, 'Agent run cancelled mid-flight');
        return {
          agentRunId: agentRun.id,
          sessionId: session?.id ?? null,
          output: null,
          status: 'cancelled',
          // streamingUsed is declared inside try and is not accessible from catch.
          // We conservatively report false here; the caller only uses this flag
          // to decide whether to close a streaming channel, which is a no-op when
          // the run was cancelled before any streaming output was produced.
          streamingUsed: false,
          tokenUsage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            model: agentDef.model,
            estimatedCostUsd: 0,
          },
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      logger.error({ agentRunId: agentRun.id, error: message }, 'Agent run failed');

      // Update AgentRun to failed
      await this.agentRunRepo.update(agentRun.id, {
        status: 'failed',
        error: message,
        completedAt: new Date(),
      });

      // Evict from pool on error (primary agents with a real session only)
      if (!isSubAgent && session && containerId !== null) {
        await this.containerPool.evict(session.id);
      }

      throw err;
    } finally {
      if (mcpConnections) {
        await mcpConnections.closeAll().catch(() => undefined);
      }
      if (!usePool && containerId !== null) {
        await this.containerRunner.stop(containerId);
      } else if (usePool) {
        this.containerPool.release(session!.id);
      }
      await this.browserSessionManager.releaseIfActive(agentRun.id).catch((err) => {
        logger.warn({ runId: agentRun.id, err }, 'browser session cleanup failed');
      });
      this.agentRunRegistry.unregister(agentRun.id);
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
