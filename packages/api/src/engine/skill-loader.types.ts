/** Parsed YAML frontmatter from a SKILL.md file. */
export interface SkillFrontmatter {
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  readonly author?: string;
  readonly tags?: readonly string[];
}

/** A discovered skill with metadata and location. */
export interface SkillInfo {
  readonly name: string;
  readonly description: string;
  readonly path: string; // Container-relative path to SKILL.md
  readonly source: 'builtin' | 'custom';
  readonly lastModified?: string; // ISO date YYYY-MM-DD, only for custom skills
  readonly stale?: boolean; // true when lastModified is older than threshold
}

/** Validation constraints. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_SKILL_NAME_LENGTH = 64;
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024;
export const MAX_SKILL_FILE_SIZE = 1024 * 1024; // 1MB
export const DEFAULT_MAX_SKILLS_PER_USER = 50;

/** Number of days after which a custom skill is considered stale. */
export const SKILL_STALENESS_THRESHOLD_DAYS = 14;

/** Staleness metadata for a single skill, keyed by container path. */
export interface SkillStalenessEntry {
  readonly name: string;
  readonly stale: boolean;
}

/** Map from container path (e.g. /workspace/skills/foo/SKILL.md) to staleness data. */
export type SkillStalenessMap = ReadonlyMap<string, SkillStalenessEntry>;
