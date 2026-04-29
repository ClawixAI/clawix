import { z } from 'zod';

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  telegramId: z.string().regex(/^\d+$/, 'Telegram ID must be numeric').nullable().optional(),
  whatsappJid: z
    .string()
    .regex(
      /^\d+@(s\.whatsapp\.net|lid)$/,
      "WhatsApp JID must look like '15551234567@s.whatsapp.net' or '12345678901234@lid' (digits + @s.whatsapp.net or @lid)",
    )
    .nullable()
    .optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
