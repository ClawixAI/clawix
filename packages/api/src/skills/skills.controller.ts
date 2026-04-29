import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import * as path from 'path';

import { SkillLoaderService } from '../engine/skill-loader.service.js';
import { SkillsService } from './skills.service.js';
import { UserAgentRepository } from '../db/user-agent.repository.js';
import { resolveWorkspacePaths } from '../engine/workspace-resolver.js';
import type { JwtPayload } from '../auth/auth.types.js';
import { createSkillSchema, renameSkillSchema, updateSkillContentSchema } from '@clawix/shared';

@ApiTags('skills')
@Controller('api/v1/skills')
export class SkillsController {
  constructor(
    private readonly skillLoader: SkillLoaderService,
    private readonly skillsService: SkillsService,
    private readonly userAgentRepo: UserAgentRepository,
  ) {}

  @Get()
  async findAll(@Req() req: { user: JwtPayload }) {
    const userAgent = await this.userAgentRepo.findByUserId(req.user.sub);
    const customDir = userAgent
      ? path.join(resolveWorkspacePaths(userAgent.workspacePath).localPath, 'skills')
      : '';
    const skills = await this.skillLoader.listSkills(customDir);
    return { success: true, data: skills };
  }

  @Get(':dirName')
  async read(@Req() req: { user: JwtPayload }, @Param('dirName') dirName: string) {
    const data = await this.skillsService.read(req.user.sub, dirName);
    return { success: true, data };
  }

  @Post()
  async create(@Req() req: { user: JwtPayload }, @Body() body: unknown) {
    const parsed = createSkillSchema.parse(body);
    await this.skillsService.create(req.user.sub, parsed);
    return { success: true };
  }

  @Put(':dirName/content')
  async updateContent(
    @Req() req: { user: JwtPayload },
    @Param('dirName') dirName: string,
    @Body() body: unknown,
  ) {
    const parsed = updateSkillContentSchema.parse(body);
    await this.skillsService.updateContent(req.user.sub, dirName, parsed.content);
    return { success: true };
  }

  @Patch(':dirName')
  async rename(
    @Req() req: { user: JwtPayload },
    @Param('dirName') dirName: string,
    @Body() body: unknown,
  ) {
    const parsed = renameSkillSchema.parse(body);
    await this.skillsService.rename(req.user.sub, dirName, parsed.newName);
    return { success: true };
  }

  @Delete(':dirName')
  async delete(@Req() req: { user: JwtPayload }, @Param('dirName') dirName: string) {
    await this.skillsService.delete(req.user.sub, dirName);
    return { success: true };
  }
}
