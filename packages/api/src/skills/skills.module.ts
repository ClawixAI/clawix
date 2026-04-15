import { Module } from '@nestjs/common';
import { EngineModule } from '../engine/engine.module.js';
import { SkillsController } from './skills.controller.js';

@Module({
  imports: [EngineModule],
  controllers: [SkillsController],
})
export class SkillsModule {}
