import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parseFrontmatter, stripFrontmatter } from '../skill-loader.service.js';
import { SkillLoaderService } from '../skill-loader.service.js';

describe('parseFrontmatter', () => {
  it('parses valid YAML frontmatter', () => {
    const content =
      '---\nname: data-parser\ndescription: Parse CSV and JSON files\nversion: 1.0.0\nauthor: jason\ntags: [data, parsing]\n---\n\n# Data Parser';
    const result = parseFrontmatter(content);
    expect(result).toEqual({
      name: 'data-parser',
      description: 'Parse CSV and JSON files',
      version: '1.0.0',
      author: 'jason',
      tags: ['data', 'parsing'],
    });
  });

  it('returns null for content without frontmatter', () => {
    expect(parseFrontmatter('# No frontmatter')).toBeNull();
  });

  it('returns null for unclosed frontmatter', () => {
    expect(parseFrontmatter('---\nname: test\n# Missing close')).toBeNull();
  });

  it('returns null when name is missing', () => {
    expect(parseFrontmatter('---\ndescription: test\n---\n')).toBeNull();
  });

  it('returns null when description is missing', () => {
    expect(parseFrontmatter('---\nname: test\n---\n')).toBeNull();
  });

  it('returns null when name exceeds max length', () => {
    const longName = 'a'.repeat(65);
    expect(parseFrontmatter(`---\nname: ${longName}\ndescription: test\n---\n`)).toBeNull();
  });

  it('returns null when name has invalid characters', () => {
    expect(parseFrontmatter('---\nname: Invalid Name!\ndescription: test\n---\n')).toBeNull();
  });

  it('strips quotes from values', () => {
    const result = parseFrontmatter('---\nname: "my-skill"\ndescription: "A skill"\n---\n');
    expect(result?.name).toBe('my-skill');
    expect(result?.description).toBe('A skill');
  });

  it('returns null when description exceeds max length', () => {
    const longDesc = 'a'.repeat(1025);
    expect(parseFrontmatter(`---\nname: test\ndescription: ${longDesc}\n---\n`)).toBeNull();
  });
});

describe('stripFrontmatter', () => {
  it('removes frontmatter and returns body', () => {
    expect(stripFrontmatter('---\nname: test\n---\n\n# Body')).toBe('# Body');
  });

  it('returns full content when no frontmatter', () => {
    expect(stripFrontmatter('# No frontmatter')).toBe('# No frontmatter');
  });
});

describe('SkillLoaderService', () => {
  let tmpDir: string;
  let builtinDir: string;
  let customDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-test-'));
    builtinDir = path.join(tmpDir, 'builtin');
    customDir = path.join(tmpDir, 'custom');
    await fs.mkdir(builtinDir, { recursive: true });
    await fs.mkdir(customDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createSkill(dir: string, name: string, frontmatter: string, body = '# Skill') {
    const skillDir = path.join(dir, name);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), `${frontmatter}\n\n${body}`);
  }

  it('discovers builtin skills', async () => {
    await createSkill(
      builtinDir,
      'summarize',
      '---\nname: summarize\ndescription: Summarize text\n---',
    );
    const service = new SkillLoaderService(builtinDir, customDir, 50);
    const skills = await service.listSkills('user1');
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('summarize');
    expect(skills[0]!.source).toBe('builtin');
  });

  it('discovers custom user skills', async () => {
    const userDir = path.join(customDir, 'user1');
    await createSkill(userDir, 'my-tool', '---\nname: my-tool\ndescription: My custom tool\n---');
    const service = new SkillLoaderService(builtinDir, customDir, 50);
    const skills = await service.listSkills('user1');
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('my-tool');
    expect(skills[0]!.source).toBe('custom');
  });

  it('custom overrides builtin by directory name', async () => {
    await createSkill(builtinDir, 'summarize', '---\nname: summarize\ndescription: Built-in\n---');
    const userDir = path.join(customDir, 'user1');
    await createSkill(
      userDir,
      'summarize',
      '---\nname: summarize\ndescription: Custom override\n---',
    );
    const service = new SkillLoaderService(builtinDir, customDir, 50);
    const skills = await service.listSkills('user1');
    expect(skills).toHaveLength(1);
    expect(skills[0]!.source).toBe('custom');
    expect(skills[0]!.description).toBe('Custom override');
  });

  it('skips directories without SKILL.md', async () => {
    await fs.mkdir(path.join(builtinDir, 'empty-dir'), { recursive: true });
    const service = new SkillLoaderService(builtinDir, customDir, 50);
    const skills = await service.listSkills('user1');
    expect(skills).toHaveLength(0);
  });

  it('skips skills with invalid frontmatter', async () => {
    await createSkill(builtinDir, 'bad-skill', '---\nname: Invalid Name!\ndescription: Bad\n---');
    const service = new SkillLoaderService(builtinDir, customDir, 50);
    const skills = await service.listSkills('user1');
    expect(skills).toHaveLength(0);
  });

  it('enforces max skills per user limit', async () => {
    const userDir = path.join(customDir, 'user1');
    for (let i = 0; i < 5; i++) {
      await createSkill(
        userDir,
        `skill-${i}`,
        `---\nname: skill-${i}\ndescription: Skill ${i}\n---`,
      );
    }
    const service = new SkillLoaderService(builtinDir, customDir, 3);
    const skills = await service.listSkills('user1');
    const customSkills = skills.filter((s) => s.source === 'custom');
    expect(customSkills.length).toBe(3);
  });

  it('user isolation - user2 cannot see user1 skills', async () => {
    const user1Dir = path.join(customDir, 'user1');
    await createSkill(
      user1Dir,
      'private-tool',
      '---\nname: private-tool\ndescription: Private\n---',
    );
    const service = new SkillLoaderService(builtinDir, customDir, 50);
    const skills = await service.listSkills('user2');
    expect(skills.filter((s) => s.name === 'private-tool')).toHaveLength(0);
  });

  it('builds XML summary with correct format', async () => {
    await createSkill(
      builtinDir,
      'summarize',
      '---\nname: summarize\ndescription: Summarize text\n---',
    );
    const service = new SkillLoaderService(builtinDir, customDir, 50);
    const summary = await service.buildSkillsSummary('user1');
    expect(summary).toContain('<skills>');
    expect(summary).toContain('<name>summarize</name>');
    expect(summary).toContain('<description>Summarize text</description>');
    expect(summary).toContain('<location>/skills/builtin/summarize/SKILL.md</location>');
    expect(summary).toContain('<source>builtin</source>');
    expect(summary).toContain('</skills>');
  });

  it('returns empty string when no skills found', async () => {
    const service = new SkillLoaderService(builtinDir, customDir, 50);
    const summary = await service.buildSkillsSummary('user1');
    expect(summary).toBe('');
  });

  it('skips symlinked skill directories', async () => {
    await createSkill(builtinDir, 'real-skill', '---\nname: real-skill\ndescription: Real\n---');
    await fs.symlink(path.join(builtinDir, 'real-skill'), path.join(builtinDir, 'symlink-skill'));
    const service = new SkillLoaderService(builtinDir, customDir, 50);
    const skills = await service.listSkills('user1');
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('real-skill');
  });

  it('escapes XML special characters in summary', async () => {
    await createSkill(
      builtinDir,
      'xml-test',
      '---\nname: xml-test\ndescription: Parse <data> & format\n---',
    );
    const service = new SkillLoaderService(builtinDir, customDir, 50);
    const summary = await service.buildSkillsSummary('user1');
    expect(summary).toContain('&lt;data&gt;');
    expect(summary).toContain('&amp;');
    expect(summary).not.toContain('<data>');
  });
});
