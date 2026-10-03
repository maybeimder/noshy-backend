import { z } from 'zod';

export const recipeAdaptationSchema = z.object({
  recipeId: z.string().min(1, 'El recipeId es obligatorio.')
});
