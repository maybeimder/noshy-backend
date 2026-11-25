import { z } from 'zod';
import { IsoDate, MealSlot } from '../../../core/shared/common.dto.js';

export const HomeQuery = z.object({ date: IsoDate.optional() });
export const HistoryQuery = z.object({ from: IsoDate, to: IsoDate });
export const DayParams = z.object({ date: IsoDate });
export const MealParams = z.object({ date: IsoDate, mealId: z.string().min(3).max(64) });
const Macros = z.object({ kcal: z.number().int().min(0).max(10000), proteinG: z.number().min(0).max(1000), carbsG: z.number().min(0).max(1000), fatG: z.number().min(0).max(1000) });
export const LogMealBody = z.union([
  z.object({ slot: MealSlot, recipeId: z.string().min(3).max(64), servings: z.number().positive().max(10).optional() }),
  z.object({ slot: MealSlot, freeText: z.string().trim().min(1).max(120), nutrition: Macros }),
  z.object({ slot: MealSlot, skipped: z.literal(true) }),
]);
export const RecommendationsQuery = z.object({
  slot: MealSlot.optional(),
  source: z.enum(['forYou', 'pantry', 'library']).optional(),
  usingIngredientIds: z
    .string()
    .max(500)
    .optional()
    .transform((s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined)),
  /** Palabras del título o las etiquetas. */
  q: z.string().trim().max(60).optional(),
  maxMinutes: z.coerce.number().int().positive().max(600).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});
export const NudgesQuery = z.object({ placement: z.enum(['home', 'myKitchen', 'pantry', 'shoppingList']) });
export const NudgeParams = z.object({ nudgeId: z.string().min(3).max(64) });
export const DismissBody = z.object({ reason: z.enum(['dismissed', 'acted']) });
