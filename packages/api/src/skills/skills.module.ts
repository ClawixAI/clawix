import { Module } from '@nestjs/common';
import { EngineModule } from '../engine/engine.module.js';
import { DbModule, UserAgentRepository } from '../db/index.js';
import { DEFAULT_MAX_SKILLS_PER_USER } from '../engine/skill-loader.types.js';
import { SkillsController } from './skills.controller.js';
import { SkillsService } from './skills.service.js';

@Module({
  imports: [EngineModule, DbModule],
  controllers: [SkillsController],
  providers: [
    {
      provide: SkillsService,
      useFactory: (userAgentRepo: UserAgentRepository) => {
        const rawMax = parseInt(
          process.env['MAX_SKILLS_PER_USER'] ?? String(DEFAULT_MAX_SKILLS_PER_USER),
          10,
        );
        const max = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : DEFAULT_MAX_SKILLS_PER_USER;
        return new SkillsService(userAgentRepo, max);
      },
      inject: [UserAgentRepository],
    },
  ],
})
export class SkillsModule {}
