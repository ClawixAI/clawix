import * as path from 'path';

import { Module, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';

import { createLogger } from '@clawix/shared';

import { DbModule } from '../db/index.js';
import { SystemSettingsModule } from '../system-settings/system-settings.module.js';
import { ProviderConfigModule } from '../provider-config/provider-config.module.js';
import { AgentRunnerService } from './agent-runner.service.js';
import { CronGuardService } from './cron-guard.service.js';
import { CronSchedulerService } from './cron-scheduler.service.js';
import { CronTaskProcessorService } from './cron-task-processor.service.js';
import { SkillLoaderService } from './skill-loader.service.js';
import { DEFAULT_MAX_SKILLS_PER_USER } from './skill-loader.types.js';
import { ContainerRunner } from './container-runner.js';
import { ContainerPoolService } from './container-pool.service.js';
import { PythonProxyHealthService } from './python-proxy-health.service.js';
import { PythonContainerPoolService } from './python-container-pool.service.js';
import { SessionManagerService } from './session-manager.service.js';
import { TokenCounterService } from './token-counter.service.js';
import { MemoryConsolidationService } from './memory-consolidation.service.js';
import { TaskExecutorService } from './task-executor.service.js';
import { ContextBuilderService } from './context-builder.service.js';
import { BootstrapFileService } from './bootstrap-file.service.js';
import { WorkspaceSeederService } from './workspace-seeder.service.js';
import { StaleRunReaperService } from './stale-run-reaper.service.js';
import { CompressorService } from './compressor.js';
import { AgentRunRegistry } from './agent-run-registry.service.js';
import { SearchProviderRegistry } from './tools/web/search-provider.js';
import { BraveSearchProvider } from './tools/web/providers/brave.js';
import { DuckDuckGoProvider } from './tools/web/providers/duckduckgo.js';
import { BrowserProviderRegistry } from './tools/browser/browser-provider-registry.js';
import { BrowserSessionSemaphore } from './tools/browser/browser-session-semaphore.js';
import { BrowserSessionManager } from './tools/browser/browser-session-manager.js';
import { LocalProvider } from './tools/browser/providers/local-provider.js';
import { BrowserbaseProvider } from './tools/browser/providers/browserbase-provider.js';
import { CdpProvider } from './tools/browser/providers/cdp-provider.js';
import {
  BrowserProviderConfigError,
  BrowserProviderUnavailableError,
} from './tools/browser/browser-provider.js';
import { BrowserQuotaCache } from './tools/browser/browser-quota-cache.service.js';
import { AgentRunSourceAdapter } from './tools/browser/agent-run-source.adapter.js';
import { PythonConcurrencyLimiter } from './tools/python/concurrency-limiter.js';
import { InstallMutex } from './tools/python/install-mutex.js';

@Module({
  imports: [DbModule, SystemSettingsModule, ProviderConfigModule],
  providers: [
    AgentRunnerService,
    ContextBuilderService,
    BootstrapFileService,
    WorkspaceSeederService,
    // String-token aliases to break circular dependency:
    // TaskExecutorService injects AgentRunnerService via @Inject('AgentRunnerService')
    // AgentRunnerService resolves TaskExecutorService lazily via ModuleRef
    { provide: 'AgentRunnerService', useExisting: AgentRunnerService },
    { provide: 'TaskExecutorService', useExisting: TaskExecutorService },
    SessionManagerService,
    TokenCounterService,
    ContainerRunner,
    ContainerPoolService,
    PythonProxyHealthService,
    PythonContainerPoolService,
    PythonConcurrencyLimiter,
    InstallMutex,
    MemoryConsolidationService,
    TaskExecutorService,
    CronGuardService,
    CronTaskProcessorService,
    CronSchedulerService,
    StaleRunReaperService,
    CompressorService,
    AgentRunRegistry,
    {
      provide: SkillLoaderService,
      useFactory: () => {
        const builtinDir =
          process.env['SKILLS_BUILTIN_DIR'] ?? path.resolve(process.cwd(), '../../skills/builtin');
        const rawMax = parseInt(
          process.env['MAX_SKILLS_PER_USER'] ?? String(DEFAULT_MAX_SKILLS_PER_USER),
          10,
        );
        const maxPerUser =
          Number.isFinite(rawMax) && rawMax > 0 ? rawMax : DEFAULT_MAX_SKILLS_PER_USER;
        return new SkillLoaderService(builtinDir, maxPerUser);
      },
    },
    BrowserProviderRegistry,
    BrowserQuotaCache,
    AgentRunSourceAdapter,
    {
      provide: BrowserSessionSemaphore,
      useFactory: (browserQuotaCache: BrowserQuotaCache) =>
        new BrowserSessionSemaphore({
          getQuota: (userId: string) => browserQuotaCache.read(userId),
          queueTimeoutMs: Number(process.env['BROWSER_QUEUE_TIMEOUT_MS'] ?? 30_000),
        }),
      inject: [BrowserQuotaCache],
    },
    BrowserSessionManager,
    {
      provide: SearchProviderRegistry,
      useFactory: () => {
        const registry = new SearchProviderRegistry();

        // Brave Search (primary, if API key configured)
        const braveApiKey = process.env['BRAVE_API_KEY'];
        if (braveApiKey) {
          const maxResults = parseInt(process.env['BRAVE_SEARCH_MAX_RESULTS'] ?? '5', 10);
          registry.addProvider(new BraveSearchProvider(braveApiKey, maxResults));
        }

        // DuckDuckGo (always available, zero-config fallback)
        registry.addProvider(new DuckDuckGoProvider());

        // Deprecation warning for legacy env var
        if (process.env['WEB_SEARCH_PROVIDER']) {
          const logger = createLogger('engine:module');
          logger.warn(
            'WEB_SEARCH_PROVIDER env var is deprecated and ignored. ' +
              'Search providers are now configured automatically (set BRAVE_API_KEY to enable Brave Search).',
          );
        }

        return registry;
      },
    },
  ],
  exports: [
    AgentRunnerService,
    SessionManagerService,
    MemoryConsolidationService,
    SearchProviderRegistry,
    WorkspaceSeederService,
    CronGuardService,
    SkillLoaderService,
    AgentRunRegistry,
    PythonProxyHealthService,
    PythonContainerPoolService,
  ],
})
export class EngineModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger('engine:module');
  private sweepInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly browserProviderRegistry: BrowserProviderRegistry,
    private readonly browserSessionManager: BrowserSessionManager,
    private readonly agentRunSourceAdapter: AgentRunSourceAdapter,
  ) {}

  onModuleDestroy(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
  }

  async onModuleInit(): Promise<void> {
    const providerName = (process.env['BROWSER_PROVIDER'] ?? 'local').toLowerCase();
    try {
      if (providerName === 'browserbase') {
        this.browserProviderRegistry.register(new BrowserbaseProvider());
      } else if (providerName === 'cdp') {
        this.browserProviderRegistry.register(new CdpProvider());
      } else {
        this.browserProviderRegistry.register(new LocalProvider());
        await this.healthCheckSidecar();
      }
      this.browserProviderRegistry.activate();
      // Attach orphan-sweep source and start 60 s periodic sweep
      this.browserSessionManager.attachAgentRunSource(this.agentRunSourceAdapter);
      this.sweepInterval = setInterval(() => {
        void this.browserSessionManager.sweepOrphans().catch(() => {});
      }, 60_000);
    } catch (err) {
      if (
        err instanceof BrowserProviderConfigError ||
        err instanceof BrowserProviderUnavailableError
      ) {
        // Soft-fail: log and disable browser tools so the API still serves
        // everything else. Per spec §Health & startup.
        this.logger.warn(`[engine] browser tools disabled: ${err.message}`);
        this.browserProviderRegistry.disable();
      } else {
        throw err;
      }
    }
  }

  private async healthCheckSidecar(): Promise<void> {
    const wsUrl = process.env['BROWSER_SIDECAR_URL'] ?? 'ws://clawix-browser:3000';
    const token = process.env['BROWSER_AUTH_TOKEN'] ?? '';
    const base = wsUrl.replace(/^ws/, 'http').replace(/\/$/, '');
    const httpUrl = `${base}/active?token=${encodeURIComponent(token)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(httpUrl, { signal: controller.signal });
      if (!res.ok) {
        throw new BrowserProviderUnavailableError(`sidecar health check returned ${res.status}`);
      }
    } catch (err) {
      if (err instanceof BrowserProviderUnavailableError) throw err;
      throw new BrowserProviderUnavailableError(
        `sidecar health check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
