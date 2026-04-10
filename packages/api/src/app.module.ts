import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import { AdminModule } from './admin/index.js';
import { DashboardModule } from './dashboard/index.js';
import { AgentsModule } from './agents/index.js';
import { AuditModule } from './audit/index.js';
import { AuthModule } from './auth/index.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { CacheModule } from './cache/index.js';
import { ChannelsModule } from './channels/index.js';
import { ChatModule } from './chat/chat.module.js';
import { AuditLogInterceptor } from './common/audit-log.interceptor.js';
import { PolicyThrottlerGuard } from './common/policy-throttler.guard.js';
import { RedisThrottlerStorage } from './common/redis-throttler.storage.js';
import { resolvePolicyLimit, resolvePolicyTtl } from './common/throttle.config.js';
import { DbModule } from './db/index.js';
import { EngineModule } from './engine/engine.module.js';
import { HealthModule } from './health/index.js';
import { AppExceptionFilter } from './filters/app-exception.filter.js';
import { MessagesModule } from './messages/index.js';
import { ProfileModule } from './profile/index.js';
import { PrismaModule } from './prisma/index.js';
import { SkillsModule } from './skills/index.js';
import { TasksModule } from './tasks/index.js';
import { SystemSettingsModule } from './system-settings/index.js';
import { TokensModule } from './tokens/index.js';
import { ProviderConfigModule } from './provider-config/provider-config.module.js';
import { WorkspaceModule } from './workspace/index.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env.local', '../../.env'],
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          limit: resolvePolicyLimit,
          ttl: resolvePolicyTtl,
        },
      ],
    }),
    PrismaModule,
    DbModule,
    EngineModule,
    CacheModule,
    AuthModule,
    AgentsModule,
    TasksModule,
    SkillsModule,
    ChannelsModule,
    ChatModule,
    MessagesModule,
    TokensModule,
    AuditModule,
    AdminModule,
    DashboardModule,
    ProfileModule,
    HealthModule,
    SystemSettingsModule,
    ProviderConfigModule,
    WorkspaceModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AppExceptionFilter,
    },
    {
      provide: ThrottlerStorage,
      useClass: RedisThrottlerStorage,
    },
    // Guard order matters: JWT populates req.user → Roles checks role → Throttler reads policyName.
    // Do NOT reorder these providers.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PolicyThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
})
export class AppModule {}
