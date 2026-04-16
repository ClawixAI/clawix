import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { ChannelsModule } from '../channels/index.js';
import { EngineModule } from '../engine/engine.module.js';

@Module({
  imports: [ChannelsModule, EngineModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
