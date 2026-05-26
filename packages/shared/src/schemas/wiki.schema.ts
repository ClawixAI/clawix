import { z } from 'zod';

export const wikiScopeSchema = z.enum(['AMBIENT', 'ARCHIVED']);
export type WikiScope = z.infer<typeof wikiScopeSchema>;

export const wikiTagSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9][a-z0-9:-]{0,49}$/, 'tags must be lowercase alphanumeric with : -');

export const wikiSlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_][a-z0-9_-]{0,79}$/, 'slug must be lowercase ASCII with dashes / underscores');

const baseWikiPageFields = {
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(200),
  content: z.string().max(10000),
  tags: z.array(wikiTagSchema).max(20).optional(),
  scope: wikiScopeSchema.optional(),
};

export const createWikiPageSchema = z.object(baseWikiPageFields);
export const updateWikiPageSchema = z.object({
  ...baseWikiPageFields,
  title: baseWikiPageFields.title.optional(),
  summary: baseWikiPageFields.summary.optional(),
  content: baseWikiPageFields.content.optional(),
});

export const wikiSearchQuerySchema = z.object({
  query: z.string().min(1).max(500),
  tags: z.array(wikiTagSchema).optional(),
  ownership: z.enum(['mine', 'visible']).default('visible'),
  limit: z.number().int().min(1).max(30).default(10),
});

export const wikiIndexQuerySchema = z.object({
  tags: z.array(wikiTagSchema).optional(),
  scope: wikiScopeSchema.optional(),
  ownership: z.enum(['mine', 'visible']).default('visible'),
  limit: z.number().int().min(1).max(200).default(50),
});

export const wikiShareTargetSchema = z.discriminatedUnion('targetType', [
  z.object({ targetType: z.literal('group'), groupId: z.string().min(1) }),
  z.object({ targetType: z.literal('org') }),
]);

export type CreateWikiPageInput = z.infer<typeof createWikiPageSchema>;
export type UpdateWikiPageInput = z.infer<typeof updateWikiPageSchema>;
export type WikiSearchQuery = z.infer<typeof wikiSearchQuerySchema>;
export type WikiIndexQuery = z.infer<typeof wikiIndexQuerySchema>;
export type WikiShareTarget = z.infer<typeof wikiShareTargetSchema>;

// --- Graph view --------------------------------------------------------

export interface WikiGraphNode {
  id: string;
  slug: string;
  title: string;
  summary: string;
  domain: string | null;
  isDaily: boolean;
  scope: 'AMBIENT' | 'ARCHIVED';
  isOwned: boolean;
  isOrgShared: boolean;
}

export interface WikiGraphEdge {
  from: string;
  to: string;
}

export interface WikiGraph {
  nodes: WikiGraphNode[];
  edges: WikiGraphEdge[];
}

export const wikiGraphQuerySchema = z.object({
  ownership: z.enum(['mine', 'visible']).default('visible'),
});

export type WikiGraphQuery = z.infer<typeof wikiGraphQuerySchema>;
