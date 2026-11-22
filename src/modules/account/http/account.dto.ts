import { z } from 'zod';

export const VerifyEmailBody = z.object({ code: z.string().regex(/^\d{6}$/, 'El código tiene 6 dígitos') });
export const SettingsPatchBody = z
  .object({
    account: z
      .object({
        name: z.string().trim().min(1).max(60),
        lastName: z.string().trim().max(60).nullable(),
        grammaticalGender: z.enum(['feminine', 'masculine', 'neutral']).nullable(),
        avatarMediaId: z.string().max(64).nullable(),
      })
      .partial(),
    chef: z
      .object({
        tone: z.enum(['direct', 'conversational']),
        proactivity: z.enum(['all', 'important', 'none']),
        readStepsAloud: z.boolean(),
        units: z.enum(['metric', 'imperial']),
      })
      .partial(),
    notifications: z.object({ expiring: z.boolean(), dailyIdeas: z.boolean(), community: z.boolean() }).partial(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Manda al menos una sección');
export const DeleteAccountBody = z.object({ confirm: z.literal(true) });
export const ExportParams = z.object({ exportId: z.string().min(3).max(64) });
