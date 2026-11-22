import { z } from 'zod';

export const RecipeDetailQuery = z.object({
  servings: z.coerce.number().int().min(1).max(20).optional(),
  adapted: z.enum(['true', 'false']).optional(),
});
export const ApplyAdaptationBody = z.object({ proposalId: z.string().min(3).max(64) });
export const CookedQuery = z.object({
  filter: z.string().max(20).optional(),
  sort: z.enum(['recent', 'mostCooked']).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export const EstimateBody = z.object({ text: z.string().trim().min(1).max(200) });
