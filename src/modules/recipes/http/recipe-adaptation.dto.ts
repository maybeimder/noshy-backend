import { z } from 'zod';

export const recipeAdaptationSchema = z.object({
  planId: z.string().min(1, 'El planId es obligatorio.'),
  recipeId: z.string().min(1, 'El recipeId es obligatorio.')
});
