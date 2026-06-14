import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SkillsService } from '../skills.service.js';
import type { UserRepository } from '../../db/user.repository.js';
import type { PolicyRepository } from '../../db/policy.repository.js';

function makeUserAgentRepo(workspacePath: string) {
  return {
    findByUserId: vi.fn(async () => ({ workspacePath })),
  } as unknown as import('../../db/user-agent.repository.js').UserAgentRepository;
}

/**
 * Build a SkillsService whose per-user skill cap resolves to `maxSkills`
 * through the policy chain (user → policyId → Policy.maxSkills).
 */
function makeService(maxSkills = 50, workspacePath = 'workspace') {
  const userRepo = {
    findById: vi.fn(async () => ({ id: 'user1', policyId: 'policy-1' })),
  } as unknown as UserRepository;
  const policyRepo = {
    findById: vi.fn(async () => ({ id: 'policy-1', maxSkills })),
  } as unknown as PolicyRepository;
  return new SkillsService(makeUserAgentRepo(workspacePath), userRepo, policyRepo);
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
    const service = makeService(50);
    await service.create('user1', { name: 'my-skill', description: 'Does a thing' });
    const content = await fs.readFile(path.join(skillsDir, 'my-skill', 'SKILL.md'), 'utf-8');
    expect(content).toContain('name: my-skill');
    expect(content).toContain('description: Does a thing');
  });

  it('rejects creating a skill with an existing dir name', async () => {
    const service = makeService(50);
    await service.create('user1', { name: 'dup', description: 'd' });
    await expect(service.create('user1', { name: 'dup', description: 'd' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('enforces the per-policy maxSkills limit on create', async () => {
    const service = makeService(2);
    await service.create('user1', { name: 'a', description: 'a' });
    await service.create('user1', { name: 'b', description: 'b' });
    await expect(service.create('user1', { name: 'c', description: 'c' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('resolves the skill cap from the user policy, not a global constant', async () => {
    // A different policy with a higher cap should allow more skills.
    const service = makeService(3);
    await service.create('user1', { name: 'a', description: 'a' });
    await service.create('user1', { name: 'b', description: 'b' });
    await expect(service.create('user1', { name: 'c', description: 'c' })).resolves.toBeUndefined();
  });

  it('reads SKILL.md content for a custom skill', async () => {
    const service = makeService(50);
    await service.create('user1', { name: 'reader', description: 'r' });
    const got = await service.read('user1', 'reader');
    expect(got.dirName).toBe('reader');
    expect(got.name).toBe('reader');
    expect(got.description).toBe('r');
    expect(got.content).toContain('name: reader');
  });

  it('throws NotFound when reading a missing skill', async () => {
    const service = makeService(50);
    await expect(service.read('user1', 'no-such')).rejects.toThrow(NotFoundException);
  });

  it('updates SKILL.md content with valid frontmatter', async () => {
    const service = makeService(50);
    await service.create('user1', { name: 'edit-me', description: 'orig' });
    const newContent = `---\nname: edit-me\ndescription: updated\n---\n\n# Body`;
    await service.updateContent('user1', 'edit-me', newContent);
    const got = await service.read('user1', 'edit-me');
    expect(got.description).toBe('updated');
  });

  it('rejects update with invalid frontmatter', async () => {
    const service = makeService(50);
    await service.create('user1', { name: 'edit-me', description: 'orig' });
    await expect(service.updateContent('user1', 'edit-me', 'no frontmatter here')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('renames a skill directory and rewrites frontmatter name', async () => {
    const service = makeService(50);
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
    const service = makeService(50);
    await service.create('user1', { name: 'a', description: 'd' });
    await service.create('user1', { name: 'b', description: 'd' });
    await expect(service.rename('user1', 'a', 'b')).rejects.toThrow(ConflictException);
  });

  it('deletes a skill directory recursively', async () => {
    const service = makeService(50);
    await service.create('user1', { name: 'goner', description: 'd' });
    await service.delete('user1', 'goner');
    const exists = await fs
      .stat(path.join(skillsDir, 'goner'))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it('rejects path traversal in dirName', async () => {
    const service = makeService(50);
    await expect(service.read('user1', '../escape')).rejects.toThrow(BadRequestException);
  });
});
