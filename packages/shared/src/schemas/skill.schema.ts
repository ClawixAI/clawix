import { z } from 'zod';

export const skillNameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(64, 'Name must be 64 characters or fewer')
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Name must be lowercase alphanumeric with hyphens');

export const skillDescriptionSchema = z
  .string()
  .min(1, 'Description is required')
  .max(1024, 'Description must be 1024 characters or fewer');

export const skillContentSchema = z.string().max(1_048_576, 'SKILL.md must be 1 MB or less');

export const createSkillSchema = z.object({
  name: skillNameSchema,
  description: skillDescriptionSchema,
});
export type CreateSkillInput = z.infer<typeof createSkillSchema>;

export const renameSkillSchema = z.object({
  newName: skillNameSchema,
});
export type RenameSkillInput = z.infer<typeof renameSkillSchema>;

export const updateSkillContentSchema = z.object({
  content: skillContentSchema,
});
export type UpdateSkillContentInput = z.infer<typeof updateSkillContentSchema>;

export interface SkillReadResult {
  readonly dirName: string;
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly modifiedAt: string; // ISO 8601
}
