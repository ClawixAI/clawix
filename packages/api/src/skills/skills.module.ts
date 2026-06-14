import { Module } from '@nestjs/common';
import { EngineModule } from '../engine/engine.module.js';
import { DbModule } from '../db/index.js';
import { SkillsController } from './skills.controller.js';
import { SkillsService } from './skills.service.js';

@Module({
  imports: [EngineModule, DbModule],
  controllers: [SkillsController],
  providers: [SkillsService],
})
export class SkillsModule {}
