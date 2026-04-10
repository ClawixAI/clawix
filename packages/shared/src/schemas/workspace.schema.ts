import { z } from 'zod';

export const pathSchema = z
  .string()
  .min(1, 'Path is required')
  .refine((val) => !/[\x00-\x1f]/.test(val), 'Path contains invalid characters');

export const filenameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(255, 'Name must be 255 characters or fewer')
  .refine((val) => !/[/\\]/.test(val), 'Name cannot contain slashes')
  .refine((val) => !/[\x00-\x1f]/.test(val), 'Name contains invalid characters');

export const createEntrySchema = z.object({
  path: pathSchema,
  type: z.enum(['file', 'directory']),
});
export type CreateEntryInput = z.infer<typeof createEntrySchema>;

export const renameSchema = z.object({
  path: pathSchema,
  newName: filenameSchema,
});
export type RenameInput = z.infer<typeof renameSchema>;

export const moveSchema = z.object({
  path: pathSchema,
  destination: pathSchema,
});
export type MoveInput = z.infer<typeof moveSchema>;

export const deleteSchema = z.object({
  path: pathSchema,
});
export type DeleteInput = z.infer<typeof deleteSchema>;

export const updateContentSchema = z.object({
  path: pathSchema,
  content: z.string().max(1_048_576, 'Content must be 1 MB or less'),
  expectedModifiedAt: z.string().datetime('Invalid ISO 8601 date'),
  force: z.boolean().optional(),
});
export type UpdateContentInput = z.infer<typeof updateContentSchema>;
