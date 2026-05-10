import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { SkillLoaderService } from '../skill-loader.service.js';
import { SKILL_STALENESS_THRESHOLD_DAYS } from '../skill-loader.types.js';

describe('SkillLoaderService - staleness', () => {
  let tmpDir: string;
  let builtinDir: string;
  let customDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-stale-'));
    builtinDir = path.join(tmpDir, 'builtin');
    customDir = path.join(tmpDir, 'workspace', 'skills');
    await fs.mkdir(builtinDir, { recursive: true });
    await fs.mkdir(customDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createSkill(
    dir: string,
    name: string,
    frontmatter: string,
    body = '# Skill',
    mtime?: Date,
  ) {
    const skillDir = path.join(dir, name);
    await fs.mkdir(skillDir, { recursive: true });
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    await fs.writeFile(skillMdPath, `${frontmatter}\n\n${body}`);
    if (mtime) {
      await fs.utimes(skillMdPath, mtime, mtime);
    }
  }

  it('includes last-modified XML for custom skills', async () => {
    const mtime = new Date('2026-04-20T12:00:00Z');
    await createSkill(
      customDir,
      'my-tool',
      '---\nname: my-tool\ndescription: My tool\n---',
      '# Skill',
      mtime,
    );
    const service = new SkillLoaderService(builtinDir, 50);
    const { xml } = await service.buildSkillsSummary(customDir);
    expect(xml).toContain('<last-modified>2026-04-20</last-modified>');
  });

  it('marks stale=true for skills older than threshold', async () => {
    const oldDate = new Date(Date.now() - 20 * 86_400_000);
    await createSkill(
      customDir,
      'old-skill',
      '---\nname: old-skill\ndescription: Old\n---',
      '# Skill',
      oldDate,
    );
    const service = new SkillLoaderService(builtinDir, 50);
    const { xml, stalenessMap } = await service.buildSkillsSummary(customDir);
    expect(xml).toContain('<stale>true</stale>');
    const entry = stalenessMap.get('/workspace/skills/old-skill/SKILL.md');
    expect(entry).toBeDefined();
    expect(entry!.stale).toBe(true);
  });

  it('omits stale tag for fresh skills', async () => {
    const freshDate = new Date(Date.now() - 2 * 86_400_000);
    await createSkill(
      customDir,
      'fresh-skill',
      '---\nname: fresh-skill\ndescription: Fresh\n---',
      '# Skill',
      freshDate,
    );
    const service = new SkillLoaderService(builtinDir, 50);
    const { xml, stalenessMap } = await service.buildSkillsSummary(customDir);
    expect(xml).not.toContain('<stale>');
    const entry = stalenessMap.get('/workspace/skills/fresh-skill/SKILL.md');
    expect(entry).toBeDefined();
    expect(entry!.stale).toBe(false);
  });

  it('does not include last-modified or stale for builtins', async () => {
    await createSkill(
      builtinDir,
      'builtin-skill',
      '---\nname: builtin-skill\ndescription: Builtin\n---',
    );
    const service = new SkillLoaderService(builtinDir, 50);
    const { xml } = await service.buildSkillsSummary(customDir);
    expect(xml).not.toContain('<last-modified>');
    expect(xml).not.toContain('<stale>');
  });

  it('returns staleness map with correct entries', async () => {
    const oldDate = new Date(Date.now() - 20 * 86_400_000);
    const freshDate = new Date(Date.now() - 2 * 86_400_000);
    await createSkill(
      customDir,
      'old-skill',
      '---\nname: old-skill\ndescription: Old\n---',
      '# Skill',
      oldDate,
    );
    await createSkill(
      customDir,
      'fresh-skill',
      '---\nname: fresh-skill\ndescription: Fresh\n---',
      '# Skill',
      freshDate,
    );
    const service = new SkillLoaderService(builtinDir, 50);
    const { stalenessMap } = await service.buildSkillsSummary(customDir);
    expect(stalenessMap.size).toBe(2);
    expect(stalenessMap.get('/workspace/skills/old-skill/SKILL.md')!.stale).toBe(true);
    expect(stalenessMap.get('/workspace/skills/fresh-skill/SKILL.md')!.stale).toBe(false);
  });

  it('returns empty map when no custom skills', async () => {
    await createSkill(
      builtinDir,
      'builtin-skill',
      '---\nname: builtin-skill\ndescription: Builtin\n---',
    );
    const service = new SkillLoaderService(builtinDir, 50);
    const { stalenessMap } = await service.buildSkillsSummary(customDir);
    expect(stalenessMap.size).toBe(0);
  });

  it('returns empty map and empty xml when no skills at all', async () => {
    const service = new SkillLoaderService(builtinDir, 50);
    const { xml, stalenessMap } = await service.buildSkillsSummary(customDir);
    expect(xml).toBe('');
    expect(stalenessMap.size).toBe(0);
  });

  async function writeSkill(dir: string, name: string, daysAgo: number) {
    const mtime = new Date(Date.now() - daysAgo * 86_400_000);
    await createSkill(
      dir,
      name,
      `---\nname: ${name}\ndescription: ${name} description\n---`,
      '# Skill',
      mtime,
    );
  }

  it('renders correct XML structure with staleness fields', async () => {
    await writeSkill(customDir, 'fresh-skill', 1);
    await writeSkill(customDir, 'old-skill', SKILL_STALENESS_THRESHOLD_DAYS + 10);
    await writeSkill(builtinDir, 'builtin-skill', 30);
    const service = new SkillLoaderService(builtinDir, 50);
    const { xml } = await service.buildSkillsSummary(customDir);

    expect(xml).toMatch(
      /<name>fresh-skill<\/name>[\s\S]*<last-modified>\d{4}-\d{2}-\d{2}<\/last-modified>[\s\S]*<source>custom<\/source>/,
    );
    const freshSkillBlock = xml.match(
      /<skill>[\s\S]*?<name>fresh-skill<\/name>[\s\S]*?<\/skill>/,
    )![0];
    expect(freshSkillBlock).not.toContain('<stale>');

    expect(xml).toMatch(
      /<name>old-skill<\/name>[\s\S]*<last-modified>\d{4}-\d{2}-\d{2}<\/last-modified>[\s\S]*<stale>true<\/stale>/,
    );

    expect(xml).toMatch(/<name>builtin-skill<\/name>[\s\S]*<source>builtin<\/source>/);
    expect(xml).not.toMatch(/<name>builtin-skill<\/name>[\s\S]*<last-modified>/);
  });
});
