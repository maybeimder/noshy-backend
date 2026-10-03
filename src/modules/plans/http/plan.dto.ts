import { z } from 'zod';

export const planInputSchema = z.object({
  days: z.number().int().min(1, 'Los días deben ser al menos 1.'),
  goals: z.array(z.string().trim().min(1, 'Cada meta no puede estar vacía.')).min(1, 'Debe haber al menos una meta.'),
  mealsPerDay: z.number().int().min(1, 'Debe haber al menos una comida por día.'),
  recipeIds: z.array(z.string().min(1)).min(1, 'Debe haber al menos una receta.')
});

export const shoppingListInputSchema = z.object({
  planId: z.string().min(1, 'El planId es obligatorio.')
});

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
