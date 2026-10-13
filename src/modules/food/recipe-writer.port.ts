import type { NutritionPlan } from '../plans/plan.model';
import type { LibraryRecipeData } from './food-catalog.port';

export type RecipeWriterIngredient = {
  name: string;
  grams?: number;
  // Id de products_slim, si el usuario lo eligió del dropdown.
  foodId?: string;
};

export type RecipeWriterContext = {
  ingredients: RecipeWriterIngredient[];
  references: LibraryRecipeData[];
  servings: number;
  notes?: string;
  nutritionPlan?: NutritionPlan;
};

// El modelo SOLO redacta la receta: los macros los calcula el back con products_slim.
export type WrittenRecipe = {
  title: string;
  servings: number;
  ingredients: { name: string; grams: number; foodId?: string }[];
  steps: string[];
  notes?: string;
  // Tipo de comida según el modelo (se suma a los tags deducidos).
  mealType?: RecipeMealType;
};

export const RECIPE_MEAL_TYPES = ['desayuno', 'almuerzo', 'cena', 'merienda', 'postre', 'bebida'] as const;
export type RecipeMealType = (typeof RECIPE_MEAL_TYPES)[number];

// Puerto de IA del módulo (OpenRouter en infrastructure/ai).
export interface RecipeWriterPort {
  // Español -> inglés, en el formato de `ner` (minúsculas, singular, sin cantidades). Mismo orden y largo.
  translateIngredients(names: string[]): Promise<string[]>;
  writeRecipe(context: RecipeWriterContext): Promise<WrittenRecipe>;
}

export function createUnavailableRecipeWriter(): RecipeWriterPort {
  const unavailable = async (): Promise<never> => {
    throw new Error('RECIPE_WRITER_NOT_CONFIGURED');
  };
  return { translateIngredients: unavailable, writeRecipe: unavailable };
}
