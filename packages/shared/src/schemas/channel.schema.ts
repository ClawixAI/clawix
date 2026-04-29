import { z } from 'zod';

const channelTypeSchema = z.enum(['telegram', 'whatsapp', 'web']);

export const createChannelSchema = z.object({
  type: channelTypeSchema,
  name: z.string().min(1, 'name is required').max(128),
  config: z.record(z.unknown()).optional().default({}),
  isActive: z.boolean().optional().default(true),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;

export const updateChannelSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  config: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;
