import { z } from 'zod';
import { UNITS } from '../domain/quantity.js';
import { MEAL_SLOTS, STORAGES } from '../domain/catalog.js';

export const Unit = z.enum(UNITS);
export const QuantityInput = z.object({ value: z.number().positive().max(100_000), unit: Unit });
export const MoneyInput = z.object({ amount: z.number().int().nonnegative().max(100_000_000), currency: z.literal('COP').default('COP') });
export const MealSlot = z.enum(MEAL_SLOTS);
export const Storage = z.enum(STORAGES);
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato YYYY-MM-DD');

export const Page = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const IdParam = (name: string) => z.object({ [name]: z.string().min(3).max(64) });
export const RecipeIdParam = z.object({ recipeId: z.string().min(3).max(64) });
