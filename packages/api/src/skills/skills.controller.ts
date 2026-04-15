import { Controller, Get, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { SkillLoaderService } from '../engine/skill-loader.service.js';
import type { JwtPayload } from '../auth/auth.types.js';

@ApiTags('skills')
@Controller('api/v1/skills')
export class SkillsController {
  constructor(private readonly skillLoader: SkillLoaderService) {}

  @Get()
  async findAll(@Req() req: { user: JwtPayload }) {
    const skills = await this.skillLoader.listSkills(req.user.sub);
    return {
      success: true,
      data: skills,
    };
  }
}
