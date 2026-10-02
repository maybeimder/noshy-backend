import { z } from 'zod';

export const closeChefSessionSchema = z.object({
  reason: z.enum(['manual', 'timeout', 'error']),
  preferencesMarkdown: z.string().max(100_000)
});
