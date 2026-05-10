import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module.js';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';

@Module({
  imports: [NotificationsModule],
  controllers: [AgentsController],
  providers: [AgentsService],
})
export class AgentsModule {}
