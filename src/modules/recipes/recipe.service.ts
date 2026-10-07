import { randomUUID } from 'node:crypto';
import { db } from '../../infrastructure/persistence/persistence';
import {
  RecipeCreatedEvent,
  RecipeDeletedEvent,
  RecipePublishedEvent,
  RecipeUnpublishedEvent,
  RecipeUpdatedEvent
} from './events/recipe.events';
import type { Recipe, RecipeIngredient, RecipeInput, RecipeUpdate } from './recipe.model';

const notFound = { ok: false, code: 'RECIPE_NOT_FOUND', message: 'No existe la receta solicitada.' } as const;

const cleanIngredients = (ingredients: RecipeIngredient[]) =>
  ingredients.map((ingredient) => ({
    name: ingredient.name.trim(),
    quantity: Number(ingredient.quantity),
    unit: ingredient.unit.trim()
  }));

const cleanInstructions = (instructions: string[]) => instructions.map((instruction) => instruction.trim()).filter(Boolean);

const withoutOwner = ({ userId: _userId, ...recipe }: Recipe) => recipe;

export async function createRecipe(userId: string, input: RecipeInput) {
  const recipe: Recipe = {
    id: randomUUID(),
    userId,
    title: input.title.trim(),
    ingredients: cleanIngredients(input.ingredients),
    instructions: cleanInstructions(input.instructions),
    isPublic: false,
    createdAt: new Date().toISOString()
  };

  return db().uow.transaction(async (tx) => {
    await db().recipes.insert(recipe, tx);
    await db().events.append([new RecipeCreatedEvent({ userId, recipe })], tx);
    return recipe;
  });
}

export function listRecipes(userId: string) {
  return db().recipes.listByUser(userId);
}

export async function updateRecipe(userId: string, recipeId: string, input: RecipeUpdate) {
  return db().uow.transaction(async (tx) => {
    const current = await db().recipes.findById(userId, recipeId, tx);
    if (!current) {
      return notFound;
    }

    const recipe: Recipe = {
      ...current,
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.ingredients !== undefined ? { ingredients: cleanIngredients(input.ingredients) } : {}),
      ...(input.instructions !== undefined ? { instructions: cleanInstructions(input.instructions) } : {})
    };
    await db().recipes.update(recipe, tx);
    await db().events.append([new RecipeUpdatedEvent({ userId, recipe })], tx);
    return { ok: true, data: recipe } as const;
  });
}

export async function deleteRecipe(userId: string, recipeId: string) {
  return db().uow.transaction(async (tx) => {
    if (!(await db().recipes.delete(userId, recipeId, tx))) {
      return notFound;
    }

    await db().events.append([new RecipeDeletedEvent({ userId, recipeId })], tx);
    return { ok: true } as const;
  });
}

// Propia, o pública de otro usuario.
export async function getRecipeForChef(userId: string, recipeId: string) {
  return (await db().recipes.findById(userId, recipeId)) ?? (await db().recipes.findPublicById(recipeId));
}

export async function publishRecipe(userId: string, recipeId: string, authorName: string) {
  return db().uow.transaction(async (tx) => {
    const current = await db().recipes.findById(userId, recipeId, tx);
    if (!current) {
      return notFound;
    }

    const recipe: Recipe = {
      ...current,
      isPublic: true,
      authorName,
      publishedAt: current.publishedAt ?? new Date().toISOString()
    };
    await db().recipes.update(recipe, tx);
    await db().events.append([new RecipePublishedEvent({ userId, recipe })], tx);
    return { ok: true, data: recipe } as const;
  });
}

export async function unpublishRecipe(userId: string, recipeId: string) {
  return db().uow.transaction(async (tx) => {
    const current = await db().recipes.findById(userId, recipeId, tx);
    if (!current) {
      return notFound;
    }

    const recipe: Recipe = { ...current, isPublic: false };
    await db().recipes.update(recipe, tx);
    await db().events.append([new RecipeUnpublishedEvent({ userId, recipeId })], tx);
    return { ok: true, data: recipe } as const;
  });
}

export async function listCommunityRecipes() {
  return (await db().recipes.listPublic()).map(withoutOwner);
}

export async function getCommunityRecipe(recipeId: string) {
  const recipe = await db().recipes.findPublicById(recipeId);
  return recipe ? withoutOwner(recipe) : null;
}
