import { z } from 'zod';

export const IngredientSearchQuery = z.object({ q: z.string().trim().min(2).max(60), limit: z.coerce.number().int().min(1).max(30).optional() });
