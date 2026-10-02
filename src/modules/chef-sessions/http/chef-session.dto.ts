import { z } from 'zod';

export const closeChefSessionSchema = z.object({
  reason: z.enum(['manual', 'timeout', 'error']),
  preferencesMarkdown: z.string().max(100_000)
});

export const chefSessionMessageSchema = z.object({
  content: z.string().trim().min(1, 'El mensaje es requerido.').max(10_000)
});
