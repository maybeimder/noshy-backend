import { z } from 'zod';
import { Page, QuantityInput } from '../../../core/shared/common.dto.js';

export const CreateRecipeBody = z.object({ title: z.string().max(120).optional() });
export const MyRecipeParams = z.object({ recipeId: z.string().min(3).max(64) });
export const PatchRecipeBody = z
  .object({
    title: z.string().max(120),
    coverMediaId: z.string().max(64),
    totalTimeMinutes: z.number().int().min(1).max(1440),
    servings: z.number().int().min(1).max(20),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    ingredients: z.array(z.object({ ingredientId: z.string().max(64), quantity: QuantityInput, prep: z.string().max(80).optional() })).max(60),
    steps: z.array(z.object({ text: z.string().trim().min(1).max(1000), timerSeconds: z.number().int().min(1).max(86_400).optional(), heat: z.enum(['low', 'medium', 'high']).optional(), ingredientIds: z.array(z.string().min(3).max(64)).max(60).optional() })).max(40),
    chefConsultable: z.object({ enabled: z.boolean(), useMyStyle: z.boolean(), suggestSubstitutes: z.boolean() }),
  })
  .partial();
export const MyRecipesQuery = Page.extend({ status: z.enum(['draft', 'inReview', 'published', 'rejected']).optional() });
