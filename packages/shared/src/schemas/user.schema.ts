import { z } from 'zod';

const userRoleSchema = z.enum(['admin', 'developer', 'viewer']);

export const createUserSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(255),
  password: z.string().min(8).max(128),
  role: userRoleSchema,
  policyId: z.string().cuid(),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  role: userRoleSchema.optional(),
  isActive: z.boolean().optional(),
  policyId: z.string().cuid().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
