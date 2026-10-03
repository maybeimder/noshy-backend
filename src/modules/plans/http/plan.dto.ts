import { z } from 'zod';

const nutritionTargetsSchema = z.object({
  calories: z.number().positive().optional(),
  carbohydratesGrams: z.number().positive().optional(),
  proteinGrams: z.number().positive().optional(),
  fatGrams: z.number().positive().optional()
}).refine((targets) => Object.keys(targets).length > 0, 'Debe existir al menos un objetivo nutricional.');

export const nutritionPlanInputSchema = z.object({
  objective: z.enum(['lose_weight', 'gain_weight', 'burn_fat', 'gain_muscle', 'maintain', 'custom']),
  targets: nutritionTargetsSchema,
  restrictions: z.array(z.string().trim().min(1)).optional(),
  mealsPerDay: z.number().int().min(1).max(12).optional()
});
