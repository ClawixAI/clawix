import { z } from 'zod';

/**
 * Tag validation for the custom-memory feature.
 *
 * Same character set as today's memory tags (`[a-z0-9-]`) plus `:` to
 * support prefix conventions:
 *   - `domain:<x>` — kanban column membership
 *   - `daily:YYYY-MM-DD` — daily-notes flow (governed elsewhere)
 *
 * Org-wide sharing is NOT a tag — it's a `MemoryShare(targetType=ORG)`
 * row, matching the original Phase-1 sharing model. The `orgShared`
 * boolean below is what the editor toggles to write/revoke that row.
 */
export const memoryTagSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9:-]{0,49}$/, 'Tag must be lowercase alphanumeric/colon/hyphen, max 50');

const memoryTagsSchema = z.array(memoryTagSchema).max(10, 'Max 10 tags per item');

const memoryContentSchema = z.unknown().refine((v) => v !== undefined, 'content is required');

export const createMemoryItemSchema = z.object({
  content: memoryContentSchema,
  tags: memoryTagsSchema.default([]),
  orgShared: z.boolean().optional(),
});

export type CreateMemoryItemInput = z.infer<typeof createMemoryItemSchema>;

export const updateMemoryItemSchema = z
  .object({
    content: memoryContentSchema.optional(),
    tags: memoryTagsSchema.optional(),
    orgShared: z.boolean().optional(),
  })
  .refine(
    (v) => v.content !== undefined || v.tags !== undefined || v.orgShared !== undefined,
    'Provide at least one of content, tags, or orgShared',
  );

export type UpdateMemoryItemInput = z.infer<typeof updateMemoryItemSchema>;

export const memoryListScopeSchema = z.enum(['mine', 'visible']);
export type MemoryListScope = z.infer<typeof memoryListScopeSchema>;

export const memoryListQuerySchema = z.object({
  scope: memoryListScopeSchema.default('mine'),
});

export type MemoryListQuery = z.infer<typeof memoryListQuerySchema>;
