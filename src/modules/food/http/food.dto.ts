import { z } from 'zod';

// Todos los textos son z.string(): un objeto como { "$ne": "" } se rechaza antes de llegar a Mongo.
const foodId = z.string().trim().min(1, 'El id del alimento es obligatorio.').max(64);

// GET /food/products?q=arroz blanco&limit=10 (la query string llega como texto).
export const foodSearchSchema = z.object({
  q: z.string().trim().min(2, 'Escribe al menos 2 caracteres.').max(80),
  limit: z.coerce.number().int().min(1).max(20).default(10)
});

// Cantidad de un alimento: gramos, o una porción de `servings` (ej. "1 taza") por una cantidad.
// Sin ninguna de las dos se usan 100 g y se avisa en `warnings`.
export const foodPortionSchema = z
  .object({
    foodId,
    grams: z.number().positive('Los gramos deben ser mayores que cero.').max(10_000).optional(),
    serving: z.string().trim().min(1).max(60).optional(),
    quantity: z.number().positive('La cantidad debe ser mayor que cero.').max(1_000).optional()
  })
  .refine((value) => !(value.grams !== undefined && value.serving !== undefined), 'Envía gramos o una porción, no ambos.');

export const macroCalculationSchema = z.object({
  items: z.array(foodPortionSchema).min(1, 'Envía al menos un alimento.').max(30),
  // true: además de calcular, registra la comida en el historial (evento food.meal_logged).
  log: z.boolean().default(false),
  label: z.string().trim().min(1).max(80).optional()
});

// GET /food/library/recipes?ingredients=pollo,arroz&maxIngredients=10
export const librarySearchSchema = z.object({
  ingredients: z
    .string()
    .trim()
    .min(1, 'Envía al menos un ingrediente.')
    .max(200)
    .transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean))
    .pipe(z.array(z.string().max(40)).min(1, 'Envía al menos un ingrediente.').max(8, 'Máximo 8 ingredientes.')),
  maxIngredients: z.coerce.number().int().min(1).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(10).default(5)
});

export const recipeGenerationSchema = z.object({
  ingredients: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'El nombre del ingrediente es obligatorio.').max(60),
        grams: z.number().positive().max(10_000).optional(),
        foodId: foodId.optional()
      })
    )
    .min(1, 'Envía al menos un ingrediente.')
    .max(12),
  servings: z.number().int().min(1).max(12).default(2),
  notes: z.string().trim().max(300).optional()
});

export const foodHistorySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export type FoodSearchInput = z.infer<typeof foodSearchSchema>;
export type MacroCalculationInput = z.infer<typeof macroCalculationSchema>;
export type LibrarySearchInput = z.infer<typeof librarySearchSchema>;
export type RecipeGenerationInput = z.infer<typeof recipeGenerationSchema>;
