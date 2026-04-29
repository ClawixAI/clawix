import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SkillsService } from '../skills.service.js';

function makeUserAgentRepo(workspacePath: string) {
  return {
    findByUserId: vi.fn(async () => ({ workspacePath })),
  } as unknown as import('../../db/user-agent.repository.js').UserAgentRepository;
}

describe('SkillsService', () => {
  let tmpDir: string;
  let workspaceDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-service-'));
    workspaceDir = path.join(tmpDir, 'workspace');
    skillsDir = path.join(workspaceDir, 'skills');
    await fs.mkdir(skillsDir, { recursive: true });
    vi.stubEnv('WORKSPACE_BASE_PATH', tmpDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates a skill with template SKILL.md', async () => {
    const service = new SkillsService(makeUserAgentRepo('workspace'), 50);
    await service.create('user1', { name: 'my-skill', description: 'Does a thing' });
    const content = await fs.readFile(path.join(skillsDir, 'my-skill', 'SKILL.md'), 'utf-8');
    expect(content).toContain('name: my-skill');
    expect(content).toContain('description: Does a thing');
  });

  it('rejects creating a skill with an existing dir name', async () => {
    const service = new SkillsService(makeUserAgentRepo('workspace'), 50);
    await service.create('user1', { name: 'dup', description: 'd' });
    await expect(service.create('user1', { name: 'dup', description: 'd' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('enforces MAX_SKILLS_PER_USER on create', async () => {
    const service = new SkillsService(makeUserAgentRepo('workspace'), 2);
    await service.create('user1', { name: 'a', description: 'a' });
    await service.create('user1', { name: 'b', description: 'b' });
    await expect(service.create('user1', { name: 'c', description: 'c' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('reads SKILL.md content for a custom skill', async () => {
    const service = new SkillsService(makeUserAgentRepo('workspace'), 50);
    await service.create('user1', { name: 'reader', description: 'r' });
    const got = await service.read('user1', 'reader');
    expect(got.dirName).toBe('reader');
    expect(got.name).toBe('reader');
    expect(got.description).toBe('r');
    expect(got.content).toContain('name: reader');
  });

  it('throws NotFound when reading a missing skill', async () => {
    const service = new SkillsService(makeUserAgentRepo('workspace'), 50);
    await expect(service.read('user1', 'no-such')).rejects.toThrow(NotFoundException);
  });

  it('updates SKILL.md content with valid frontmatter', async () => {
    const service = new SkillsService(makeUserAgentRepo('workspace'), 50);
    await service.create('user1', { name: 'edit-me', description: 'orig' });
    const newContent = `---\nname: edit-me\ndescription: updated\n---\n\n# Body`;
    await service.updateContent('user1', 'edit-me', newContent);
    const got = await service.read('user1', 'edit-me');
    expect(got.description).toBe('updated');
  });

  it('rejects update with invalid frontmatter', async () => {
    const service = new SkillsService(makeUserAgentRepo('workspace'), 50);
    await service.create('user1', { name: 'edit-me', description: 'orig' });
    await expect(service.updateContent('user1', 'edit-me', 'no frontmatter here')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('renames a skill directory and rewrites frontmatter name', async () => {
    const service = new SkillsService(makeUserAgentRepo('workspace'), 50);
    await service.create('user1', { name: 'old-name', description: 'd' });
    await service.rename('user1', 'old-name', 'new-name');
    const got = await service.read('user1', 'new-name');
    expect(got.name).toBe('new-name');
    const oldExists = await fs
      .stat(path.join(skillsDir, 'old-name'))
      .then(() => true)
      .catch(() => false);
    expect(oldExists).toBe(false);
  });

  it('rejects rename to existing dir name', async () => {
    const service = new SkillsService(makeUserAgentRepo('workspace'), 50);
    await service.create('user1', { name: 'a', description: 'd' });
    await service.create('user1', { name: 'b', description: 'd' });
    await expect(service.rename('user1', 'a', 'b')).rejects.toThrow(ConflictException);
  });

  it('deletes a skill directory recursively', async () => {
    const service = new SkillsService(makeUserAgentRepo('workspace'), 50);
    await service.create('user1', { name: 'goner', description: 'd' });
    await service.delete('user1', 'goner');
    const exists = await fs
      .stat(path.join(skillsDir, 'goner'))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it('rejects path traversal in dirName', async () => {
    const service = new SkillsService(makeUserAgentRepo('workspace'), 50);
    await expect(service.read('user1', '../escape')).rejects.toThrow(BadRequestException);
  });
});
