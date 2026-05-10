import { z } from 'zod';

export const PUBLIC_MEMORY_DOMAIN_REGEX = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const PUBLIC_MEMORY_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,59}$/;
export const PUBLIC_MEMORY_TAG_REGEX = /^[a-z0-9][a-z0-9-]{0,30}$/;

const tagSchema = z.string().regex(PUBLIC_MEMORY_TAG_REGEX);
const titleSchema = z.string().min(1).max(200);
const descriptionSchema = z.string().min(1).max(500);
const bodySchema = z.string().max(100 * 1024);
const changeSummarySchema = z.string().max(1000);

export const createPublicMemoryCardSchema = z.object({
  title: titleSchema,
  description: descriptionSchema,
  tags: z.array(tagSchema).max(10).default([]),
  autoLoad: z.boolean().default(false),
  body: bodySchema,
  changeSummary: changeSummarySchema.optional(),
});
export type CreatePublicMemoryCardInput = z.infer<typeof createPublicMemoryCardSchema>;

export const updatePublicMemoryCardSchema = z.object({
  title: titleSchema.optional(),
  description: descriptionSchema.optional(),
  tags: z.array(tagSchema).max(10).optional(),
  autoLoad: z.boolean().optional(),
  order: z.number().int().min(0).max(1_000_000).optional(),
  body: bodySchema.optional(),
  changeSummary: changeSummarySchema.optional(),
});
export type UpdatePublicMemoryCardInput = z.infer<typeof updatePublicMemoryCardSchema>;

export const movePublicMemoryCardSchema = z.object({
  targetDomain: z.string().regex(PUBLIC_MEMORY_DOMAIN_REGEX),
  targetOrder: z.number().int().min(0).max(1_000_000).optional(),
  onCollision: z.enum(['prompt', 'use_suggested']).default('prompt'),
});
export type MovePublicMemoryCardInput = z.infer<typeof movePublicMemoryCardSchema>;

export const renamePublicMemoryCardSchema = z.object({
  newSlug: z.string().regex(PUBLIC_MEMORY_SLUG_REGEX),
});
export type RenamePublicMemoryCardInput = z.infer<typeof renamePublicMemoryCardSchema>;

export const createPublicMemoryDomainSchema = z.object({
  name: z.string().regex(PUBLIC_MEMORY_DOMAIN_REGEX),
});
export type CreatePublicMemoryDomainInput = z.infer<typeof createPublicMemoryDomainSchema>;

export const renamePublicMemoryDomainSchema = z.object({
  newName: z.string().regex(PUBLIC_MEMORY_DOMAIN_REGEX),
});
export type RenamePublicMemoryDomainInput = z.infer<typeof renamePublicMemoryDomainSchema>;
