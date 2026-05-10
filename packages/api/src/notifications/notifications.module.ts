import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { DbModule } from '../db/db.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationFanoutService } from './notifications.fanout.js';
import { NotificationsGateway } from './notifications.gateway.js';

@Module({
  imports: [DbModule, JwtModule.register({})],
  controllers: [NotificationsController],
  providers: [NotificationsGateway, NotificationFanoutService],
  exports: [NotificationFanoutService],
})
export class NotificationsModule {}
