import { z } from 'zod';

export const MenuParams = z.object({ menuId: z.string().min(3).max(64) });

export const MenuEntryParams = z.object({ menuId: z.string().min(3).max(64), entryId: z.string().min(3).max(64) });
const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Slot = z.enum(['breakfast', 'snack1', 'lunch', 'snack2', 'dinner']);
export const AddMenuEntryBody = z.object({ date: IsoDay, slot: Slot, recipeId: z.string().min(3).max(64), servings: z.number().int().min(1).max(20).optional() });
export const PatchMenuEntryBody = z
  .object({ date: IsoDay, slot: Slot, recipeId: z.string().min(3).max(64), servings: z.number().int().min(1).max(20) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Manda al menos un campo');
