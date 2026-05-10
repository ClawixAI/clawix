import { Module } from '@nestjs/common';

import { DbModule } from '../db/db.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { GroupAccessService } from './group-access.service.js';
import { GroupsController } from './groups.controller.js';

@Module({
  imports: [DbModule, NotificationsModule],
  controllers: [GroupsController],
  providers: [GroupAccessService],
  exports: [GroupAccessService],
})
export class GroupsModule {}
