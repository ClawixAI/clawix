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
}

/** Validation constraints. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_SKILL_NAME_LENGTH = 64;
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024;
export const MAX_SKILL_FILE_SIZE = 1024 * 1024; // 1MB
export const DEFAULT_MAX_SKILLS_PER_USER = 50;
