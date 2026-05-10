import { z } from 'zod';

const groupMemberRoleSchema = z.enum(['OWNER', 'MEMBER']);

export const createGroupSchema = z.object({
  name: z.string().min(1, 'name is required').max(128),
  description: z.string().max(500).optional(),
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(500).nullable().optional(),
});

export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

export const addGroupMemberSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  role: groupMemberRoleSchema.optional().default('MEMBER'),
});

export type AddGroupMemberInput = z.infer<typeof addGroupMemberSchema>;

export const updateGroupMemberSchema = z.object({
  role: groupMemberRoleSchema,
});

export type UpdateGroupMemberInput = z.infer<typeof updateGroupMemberSchema>;

// ----------------------------------------------------------------------------
// Group invite workflow (self-service)
// ----------------------------------------------------------------------------

export const groupInviteStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'REVOKED']);
export type GroupInviteStatus = z.infer<typeof groupInviteStatusSchema>;

export const inviteToGroupSchema = z
  .object({
    inviteeId: z.string().min(1).optional(),
    email: z.string().email().optional(),
  })
  .refine((v) => !!v.inviteeId || !!v.email, {
    message: 'Either inviteeId or email must be provided',
  });
export type InviteToGroupInput = z.infer<typeof inviteToGroupSchema>;

export const groupInviteListQuerySchema = z.object({
  scope: z.enum(['received', 'sent']).default('received'),
});
export type GroupInviteListQuery = z.infer<typeof groupInviteListQuerySchema>;
