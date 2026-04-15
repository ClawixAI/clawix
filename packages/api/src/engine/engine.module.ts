import * as path from 'path';

import { Module } from '@nestjs/common';

import { createLogger } from '@clawix/shared';

import { DbModule } from '../db/index.js';
import { SystemSettingsModule } from '../system-settings/system-settings.module.js';
import { ProviderConfigModule } from '../provider-config/provider-config.module.js';
import { AgentRunnerService } from './agent-runner.service.js';
import { CronGuardService } from './cron-guard.service.js';
import { CronSchedulerService } from './cron-scheduler.service.js';
import { CronTaskProcessorService } from './cron-task-processor.service.js';
import { SkillLoaderService } from './skill-loader.service.js';
import { ContainerRunner } from './container-runner.js';
import { ContainerPoolService } from './container-pool.service.js';
import { SessionManagerService } from './session-manager.service.js';
import { TokenCounterService } from './token-counter.service.js';
import { MemoryConsolidationService } from './memory-consolidation.service.js';
import { TaskExecutorService } from './task-executor.service.js';
import { ContextBuilderService } from './context-builder.service.js';
import { BootstrapFileService } from './bootstrap-file.service.js';
import { WorkspaceSeederService } from './workspace-seeder.service.js';
import { StaleRunReaperService } from './stale-run-reaper.service.js';
import { SearchProviderRegistry } from './tools/web/search-provider.js';
import { BraveSearchProvider } from './tools/web/providers/brave.js';
import { DuckDuckGoProvider } from './tools/web/providers/duckduckgo.js';

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
    MemoryConsolidationService,
    TaskExecutorService,
    CronGuardService,
    CronTaskProcessorService,
    CronSchedulerService,
    StaleRunReaperService,
    {
      provide: SkillLoaderService,
      useFactory: () => {
        const builtinDir =
          process.env['SKILLS_BUILTIN_DIR'] ?? path.resolve(process.cwd(), '../../skills/builtin');
        const customDir =
          process.env['SKILLS_CUSTOM_DIR'] ??
          path.resolve(process.env['WORKSPACE_BASE_PATH'] ?? './data', 'skills/custom');
        const maxPerUser = parseInt(process.env['MAX_SKILLS_PER_USER'] ?? '50', 10);
        return new SkillLoaderService(builtinDir, customDir, maxPerUser);
      },
    },
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
  ],
})
export class EngineModule {}
