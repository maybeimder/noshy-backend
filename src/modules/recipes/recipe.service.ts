import { randomUUID } from 'node:crypto';
import type { Recipe, RecipeInput } from './recipe.model';

const recipesByUserId = new Map<string, Recipe[]>();

export function createRecipe(userId: string, input: RecipeInput) {
  const recipe: Recipe = {
    id: randomUUID(),
    userId,
    title: input.title.trim(),
    ingredients: input.ingredients.map((ingredient) => ({
      name: ingredient.name.trim(),
      quantity: Number(ingredient.quantity),
      unit: ingredient.unit.trim()
    })),
    instructions: input.instructions.map((instruction) => instruction.trim()).filter(Boolean),
    isPublic: false,
    createdAt: new Date().toISOString()
  };

  const recipes = recipesByUserId.get(userId) ?? [];
  recipes.push(recipe);
  recipesByUserId.set(userId, recipes);

  return recipe;
}

export function listRecipes(userId: string) {
  return recipesByUserId.get(userId) ?? [];
}

export function publishRecipe(userId: string, recipeId: string, authorName: string) {
  const recipe = (recipesByUserId.get(userId) ?? []).find((entry) => entry.id === recipeId);

  if (!recipe) {
    return { ok: false, code: 'RECIPE_NOT_FOUND', message: 'No existe la receta solicitada.' } as const;
  }

  recipe.isPublic = true;
  recipe.authorName = authorName;

  return { ok: true, data: recipe } as const;
}

export function listCommunityRecipes() {
  return [...recipesByUserId.values()]
    .flat()
    .filter((recipe) => recipe.isPublic)
    .map(({ userId: _userId, ...recipe }) => recipe);
}
