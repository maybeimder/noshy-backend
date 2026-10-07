import { randomUUID } from 'node:crypto';
import { publishEvent } from '../../infrastructure/event-bus/event-bus';
import {
  RecipeCreatedEvent,
  RecipeDeletedEvent,
  RecipePublishedEvent,
  RecipeUnpublishedEvent,
  RecipeUpdatedEvent
} from './events/recipe.events';
import type { Recipe, RecipeInput, RecipeUpdate } from './recipe.model';

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
  publishEvent(new RecipeCreatedEvent({ userId, recipe }));

  return recipe;
}

export function listRecipes(userId: string) {
  return recipesByUserId.get(userId) ?? [];
}

export function updateRecipe(userId: string, recipeId: string, input: RecipeUpdate) {
  const recipe = listRecipes(userId).find((entry) => entry.id === recipeId);
  if (!recipe) {
    return { ok: false, code: 'RECIPE_NOT_FOUND', message: 'No existe la receta solicitada.' } as const;
  }

  if (input.title !== undefined) recipe.title = input.title.trim();
  if (input.ingredients !== undefined) {
    recipe.ingredients = input.ingredients.map((ingredient) => ({
      name: ingredient.name.trim(),
      quantity: Number(ingredient.quantity),
      unit: ingredient.unit.trim()
    }));
  }
  if (input.instructions !== undefined) {
    recipe.instructions = input.instructions.map((instruction) => instruction.trim()).filter(Boolean);
  }
  publishEvent(new RecipeUpdatedEvent({ userId, recipe }));
  return { ok: true, data: recipe } as const;
}

export function deleteRecipe(userId: string, recipeId: string) {
  const recipes = listRecipes(userId);
  const index = recipes.findIndex((entry) => entry.id === recipeId);
  if (index === -1) {
    return { ok: false, code: 'RECIPE_NOT_FOUND', message: 'No existe la receta solicitada.' } as const;
  }

  recipes.splice(index, 1);
  publishEvent(new RecipeDeletedEvent({ userId, recipeId }));
  return { ok: true } as const;
}

export function getRecipeForChef(userId: string, recipeId: string) {
  const ownRecipe = listRecipes(userId).find((recipe) => recipe.id === recipeId);
  if (ownRecipe) {
    return ownRecipe;
  }

  return [...recipesByUserId.values()]
    .flat()
    .find((recipe) => recipe.id === recipeId && recipe.isPublic) ?? null;
}

export function publishRecipe(userId: string, recipeId: string, authorName: string) {
  const recipe = (recipesByUserId.get(userId) ?? []).find((entry) => entry.id === recipeId);

  if (!recipe) {
    return { ok: false, code: 'RECIPE_NOT_FOUND', message: 'No existe la receta solicitada.' } as const;
  }

  recipe.isPublic = true;
  recipe.authorName = authorName;
  recipe.publishedAt = recipe.publishedAt ?? new Date().toISOString();
  publishEvent(new RecipePublishedEvent({ userId, recipe }));

  return { ok: true, data: recipe } as const;
}

export function unpublishRecipe(userId: string, recipeId: string) {
  const recipe = (recipesByUserId.get(userId) ?? []).find((entry) => entry.id === recipeId);
  if (!recipe) {
    return { ok: false, code: 'RECIPE_NOT_FOUND', message: 'No existe la receta solicitada.' } as const;
  }

  recipe.isPublic = false;
  publishEvent(new RecipeUnpublishedEvent({ userId, recipeId }));
  return { ok: true, data: recipe } as const;
}

export function listCommunityRecipes() {
  return [...recipesByUserId.values()]
    .flat()
    .filter((recipe) => recipe.isPublic)
    .map(({ userId: _userId, ...recipe }) => recipe);
}

export function getCommunityRecipe(recipeId: string) {
  const recipe = [...recipesByUserId.values()]
    .flat()
    .find((entry) => entry.id === recipeId && entry.isPublic);

  if (!recipe) {
    return null;
  }

  const { userId: _userId, ...publicRecipe } = recipe;
  return publicRecipe;
}
