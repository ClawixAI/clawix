import { z } from 'zod';

export const createPolicySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  maxTokenBudget: z.number().int().positive().nullable().optional(),
  maxAgents: z.number().int().positive().default(5),
  maxSkills: z.number().int().positive().default(10),
  maxMemoryItems: z.number().int().positive().default(1000),
  maxGroupsOwned: z.number().int().positive().default(5),
  allowedProviders: z.array(z.string().min(1)).default([]),
  cronEnabled: z.boolean().default(false),
  maxScheduledTasks: z.number().int().positive().default(5),
  minCronIntervalSecs: z.number().int().min(60).default(300),
  maxTokensPerCronRun: z.number().int().positive().nullable().optional(),
  features: z.record(z.unknown()).default({}),
});

export const updatePolicySchema = createPolicySchema.partial();

export type CreatePolicyInput = z.infer<typeof createPolicySchema>;
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;
