import { z } from 'zod';
import { IsoDate, Page, QuantityInput, Storage } from '../../../core/shared/common.dto.js';

export const SuggestionsQuery = z.object({ limit: z.coerce.number().int().min(1).max(60).optional() });
export const BulkBody = z.object({
  answers: z.array(z.object({ ingredientId: z.string().min(3).max(64), status: z.enum(['have', 'missing']) })).max(60),
  skipped: z.boolean(),
});
export const PantryListQuery = Page.extend({
  storage: Storage.optional(),
  q: z.string().trim().min(1).max(60).optional(),
  sort: z.enum(['recent', 'expiresOn', 'name']).optional(),
});
export const PantryItemParams = z.object({ itemId: z.string().min(3).max(64) });
export const PantryAddBody = z.object({
  ingredientId: z.string().min(3).max(64),
  productId: z.string().min(3).max(64).optional(),
  quantity: QuantityInput.optional(),
  storage: Storage.optional(),
});
export const PantryPatchBody = z
  .object({ remainingPct: z.number().int().min(0).max(100), storage: Storage, expiresOn: IsoDate })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Manda al menos un campo');
export const PantryDeleteQuery = z.object({ addToShoppingList: z.enum(['true', 'false']).optional() });
