import { z } from 'zod';

export const feedbackInputSchema = z.object({
  targetType: z.enum(['recipe', 'plan', 'ingredient']),
  targetId: z.string().min(1, 'El identificador es requerido.'),
  targetName: z.string().min(1, 'El nombre es requerido.'),
  rating: z.number().int().min(1).max(5),
  note: z.string().max(500).optional()
});
