import { z } from 'zod';
import { IdParam } from '../../../core/shared/common.dto.js';

export const IngredientSearchQuery = z.object({ q: z.string().trim().min(2).max(60), limit: z.coerce.number().int().min(1).max(30).optional() });
export const IngredientParams = IdParam('ingredientId');
export const ProductsQuery = z.object({ storeId: z.string().max(40).optional() });
