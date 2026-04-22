import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { EngineModule } from '../engine/engine.module.js';
import { SystemSettingsModule } from '../system-settings/system-settings.module.js';
import { TasksController } from './tasks.controller.js';
import { TaskRunsController } from './task-runs.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [DbModule, EngineModule, SystemSettingsModule],
  controllers: [TasksController, TaskRunsController],
  providers: [TasksService],
})
export class TasksModule {}
