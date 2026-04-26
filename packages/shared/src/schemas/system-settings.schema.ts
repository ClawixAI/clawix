import { z } from 'zod';

import { isValidIanaTimezone } from '../utils/timezone.js';

export const systemSettingsSchema = z.object({
  /**
   * System-wide cap for cron-run token spend (input + output cumulative,
   * shared across primary + sub-agents). `null` disables enforcement entirely
   * — opt-in only; default is a generous safety net.
   */
  cronDefaultTokenBudget: z.number().int().positive().nullable().default(1_000_000),
  cronExecutionTimeoutMs: z.number().int().positive().default(300000),
  cronTokenGracePercent: z.number().int().min(0).max(100).default(10),
  defaultTimezone: z
    .string()
    .min(1)
    .refine(isValidIanaTimezone, { message: 'Invalid IANA timezone' })
    .default('UTC'),
});

export type SystemSettingsInput = z.infer<typeof systemSettingsSchema>;

export const updateSystemSettingsSchema = systemSettingsSchema.partial();

export type UpdateSystemSettingsInput = z.infer<typeof updateSystemSettingsSchema>;

export const systemSettingsIdentitySchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens'),
  settings: z.record(z.unknown()).default({}),
});

export const updateSystemSettingsIdentitySchema = systemSettingsIdentitySchema.partial();

export type SystemSettingsIdentityInput = z.infer<typeof systemSettingsIdentitySchema>;
export type UpdateSystemSettingsIdentityInput = z.infer<typeof updateSystemSettingsIdentitySchema>;
