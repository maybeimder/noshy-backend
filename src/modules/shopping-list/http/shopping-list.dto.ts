import { z } from 'zod';

const ingredientSchema = z.object({
  name: z.string().trim().min(1),
  quantity: z.number().positive(),
  unit: z.string().trim().min(1)
});

const recipeInputSchema = z.object({
  recipeId: z.string().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  servings: z.number().positive().default(1),
  ingredients: z.array(ingredientSchema).min(1).optional()
}).refine((recipe) => recipe.recipeId !== undefined || recipe.ingredients !== undefined, {
  message: 'La receta debe incluir recipeId o ingredients.'
});

export const shoppingListInputSchema = z.object({
  recipes: z.array(recipeInputSchema).min(1)
});
