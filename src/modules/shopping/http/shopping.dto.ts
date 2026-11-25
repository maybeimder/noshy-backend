import { z } from 'zod';
import { MoneyInput, QuantityInput } from '../../../core/shared/common.dto.js';

export const CurrentListQuery = z.object({ storeId: z.string().max(40).optional(), sort: z.enum(['category', 'storeLayout']).optional() });
export const ListParams = z.object({ listId: z.string().min(3).max(64) });
export const ItemParams = z.object({ listId: z.string().min(3).max(64), itemId: z.string().min(3).max(64) });
export const ListRecipeParams = z.object({ listId: z.string().min(3).max(64), recipeId: z.string().min(3).max(64) });
export const PatchItemBody = z
  .object({ checked: z.boolean(), quantity: QuantityInput, actualPrice: MoneyInput.nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Manda al menos un campo');
export const SwapBody = z.object({ suggestionId: z.string().min(3).max(80) });
export const AddItemsBody = z.object({
  items: z
    .array(z.object({ ingredientId: z.string().min(3).max(64), quantity: QuantityInput.optional(), sourceRecipeId: z.string().max(64).optional() }))
    .min(1)
    .max(30),
});
export const AddRecipeBody = z.object({ recipeId: z.string().min(3).max(64), servings: z.number().int().min(1).max(20).optional(), adaptationId: z.string().max(64).nullish() });
export const CheckoutBody = z.object({ storeId: z.string().max(40), carryOverUnchecked: z.boolean(), receiptId: z.string().max(64).optional() });
export const ShareTokenParams = z.object({ token: z.string().min(4).max(40) });
