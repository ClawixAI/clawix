import { Global, Module } from '@nestjs/common';

import { PolicyRepository } from './policy.repository.js';
import { UserRepository } from './user.repository.js';
import { AgentDefinitionRepository } from './agent-definition.repository.js';
import { AgentRunRepository } from './agent-run.repository.js';
import { UserAgentRepository } from './user-agent.repository.js';
import { ProviderConfigRepository } from './provider-config.repository.js';
import { ChannelRepository } from './channel.repository.js';
import { TaskRepository } from './task.repository.js';
import { TaskRunRepository } from './task-run.repository.js';
import { TaskRunMessageRepository } from './task-run-message.repository.js';
import { SessionRepository } from './session.repository.js';
import { AuditLogRepository } from './audit-log.repository.js';
import { TokenUsageRepository } from './token-usage.repository.js';
import { MemoryItemRepository } from './memory-item.repository.js';
import { SystemSettingsRepository } from './system-settings.repository.js';
import { GroupRepository } from './group.repository.js';
import { GroupInviteRepository } from './group-invite.repository.js';
import { NotificationRepository } from './notification.repository.js';

const repositories = [
  PolicyRepository,
  UserRepository,
  AgentDefinitionRepository,
  AgentRunRepository,
  UserAgentRepository,
  ProviderConfigRepository,
  ChannelRepository,
  TaskRepository,
  TaskRunRepository,
  TaskRunMessageRepository,
  SessionRepository,
  AuditLogRepository,
  TokenUsageRepository,
  MemoryItemRepository,
  SystemSettingsRepository,
  GroupRepository,
  GroupInviteRepository,
  NotificationRepository,
];

@Global()
@Module({
  providers: repositories,
  exports: repositories,
})
export class DbModule {}
