import * as path from 'path';
import * as fs from 'fs/promises';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { UserAgentRepository } from '../db/user-agent.repository.js';
import { UserRepository } from '../db/user.repository.js';
import { PolicyRepository } from '../db/policy.repository.js';
import { resolveWorkspacePaths } from '../engine/workspace-resolver.js';
import { ScopedFs } from '../workspace/scoped-fs.js';
import { parseFrontmatter } from '../engine/skill-loader.service.js';
import { SKILL_NAME_PATTERN, MAX_SKILL_NAME_LENGTH } from '../engine/skill-loader.types.js';
import type { CreateSkillInput, SkillReadResult } from '@clawix/shared';

const SKILL_TEMPLATE = (name: string, description: string) =>
  `---
name: ${name}
description: ${description}
version: 1.0.0
---

# ${name}

## Overview

[Describe what this skill does and when to use it]

## Usage

[Instructions for the agent on how to use this skill]
`;

@Injectable()
export class SkillsService {
  constructor(
    private readonly userAgentRepo: UserAgentRepository,
    private readonly userRepo: UserRepository,
    private readonly policyRepo: PolicyRepository,
  ) {}

  /** Resolve the user's per-policy skill cap (`Policy.maxSkills`). */
  private async resolveMaxSkills(userId: string): Promise<number> {
    const user = await this.userRepo.findById(userId);
    const policy = await this.policyRepo.findById(user.policyId);
    return policy.maxSkills;
  }

  private validateName(name: string): void {
    if (name.length === 0 || name.length > MAX_SKILL_NAME_LENGTH) {
      throw new BadRequestException('Invalid skill name length');
    }
    if (!SKILL_NAME_PATTERN.test(name)) {
      throw new BadRequestException('Invalid skill name format');
    }
  }

  private async getScopedFs(userId: string): Promise<{ sfs: ScopedFs; basePath: string }> {
    const userAgent = await this.userAgentRepo.findByUserId(userId);
    if (!userAgent) {
      throw new NotFoundException('No workspace found for this user');
    }
    const { localPath } = resolveWorkspacePaths(userAgent.workspacePath);
    const skillsBase = path.join(localPath, 'skills');
    await fs.mkdir(skillsBase, { recursive: true });
    return { sfs: new ScopedFs(skillsBase), basePath: skillsBase };
  }

  async create(userId: string, input: CreateSkillInput): Promise<void> {
    this.validateName(input.name);
    const maxSkills = await this.resolveMaxSkills(userId);
    const { sfs, basePath } = await this.getScopedFs(userId);

    const existing = await fs.readdir(basePath, { withFileTypes: true }).catch(() => []);
    const existingDirs = existing.filter((e) => e.isDirectory()).map((e) => e.name);
    if (existingDirs.includes(input.name)) {
      throw new ConflictException(`Skill "${input.name}" already exists`);
    }
    if (existingDirs.length >= maxSkills) {
      throw new BadRequestException(`Maximum ${maxSkills} skills reached`);
    }

    await sfs.mkdir(`/${input.name}`);
    await sfs.writeFile(`/${input.name}/SKILL.md`, SKILL_TEMPLATE(input.name, input.description));
  }

  async read(userId: string, dirName: string): Promise<SkillReadResult> {
    this.validateName(dirName);
    const { sfs } = await this.getScopedFs(userId);
    const skillMdPath = `/${dirName}/SKILL.md`;
    let content: string;
    let stat: Awaited<ReturnType<typeof sfs.stat>>;
    try {
      stat = await sfs.stat(skillMdPath);
      content = (await sfs.readFile(skillMdPath, 'utf-8')) as string;
    } catch {
      throw new NotFoundException(`Skill "${dirName}" not found`);
    }
    const fm = parseFrontmatter(content);
    if (!fm) {
      throw new BadRequestException('Skill has invalid frontmatter');
    }
    return {
      dirName,
      name: fm.name,
      description: fm.description,
      content,
      modifiedAt: stat.mtime.toISOString(),
    };
  }

  async updateContent(userId: string, dirName: string, content: string): Promise<void> {
    this.validateName(dirName);
    const fm = parseFrontmatter(content);
    if (!fm) {
      throw new BadRequestException('SKILL.md must include valid frontmatter (name + description)');
    }
    const { sfs } = await this.getScopedFs(userId);
    const skillMdPath = `/${dirName}/SKILL.md`;
    try {
      await sfs.stat(skillMdPath);
    } catch {
      throw new NotFoundException(`Skill "${dirName}" not found`);
    }
    await sfs.writeFile(skillMdPath, content);
  }

  async rename(userId: string, dirName: string, newName: string): Promise<void> {
    this.validateName(dirName);
    this.validateName(newName);
    if (dirName === newName) return;

    const { sfs } = await this.getScopedFs(userId);
    const sourceExists = await sfs
      .stat(`/${dirName}`)
      .then(() => true)
      .catch(() => false);
    if (!sourceExists) {
      throw new NotFoundException(`Skill "${dirName}" not found`);
    }
    const targetExists = await sfs
      .stat(`/${newName}`)
      .then(() => true)
      .catch(() => false);
    if (targetExists) {
      throw new ConflictException(`Skill "${newName}" already exists`);
    }
    await sfs.rename(`/${dirName}`, `/${newName}`);

    // Rewrite frontmatter `name:` to match new dir name
    const skillMdRel = `/${newName}/SKILL.md`;
    const raw = (await sfs.readFile(skillMdRel, 'utf-8').catch(() => null)) as string | null;
    if (raw === null) return;
    const updated = raw.replace(/^(name:\s*).+$/m, `$1${newName}`);
    await sfs.writeFile(skillMdRel, updated);
  }

  async delete(userId: string, dirName: string): Promise<void> {
    this.validateName(dirName);
    const { sfs } = await this.getScopedFs(userId);
    const exists = await sfs
      .stat(`/${dirName}`)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      throw new NotFoundException(`Skill "${dirName}" not found`);
    }
    await sfs.remove(`/${dirName}`);
  }
}
