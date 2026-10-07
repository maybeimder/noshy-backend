// Entrada única (HTTP y RabbitMQ) del módulo de recetas.
import { defineHandler } from '../../../core/commands/command-bus';
import { recipeAdaptationSchema } from '../http/recipe-adaptation.dto';
import { recipeSchema, recipeUpdateSchema } from '../http/recipe.dto';
import { adaptRecipe } from '../recipe-adaptation.service';
import {
  createRecipe,
  deleteRecipe,
  getCommunityRecipe,
  listCommunityRecipes,
  listRecipes,
  publishRecipe,
  unpublishRecipe,
  updateRecipe
} from '../recipe.service';

export const RecipeHandlers = {
  create: 'recipes.create',
  list: 'recipes.list',
  update: 'recipes.update',
  delete: 'recipes.delete',
  publish: 'recipes.publish',
  unpublish: 'recipes.unpublish',
  adapt: 'recipes.adapt',
  communityList: 'community.list',
  communityDetail: 'community.detail'
} as const;

export const recipeHandlers = [
  defineHandler({ name: RecipeHandlers.create, schema: recipeSchema, execute: ({ userId, data }) => createRecipe(userId, data) }),
  defineHandler({ name: RecipeHandlers.list, execute: ({ userId }) => listRecipes(userId) }),
  defineHandler({
    name: RecipeHandlers.update,
    schema: recipeUpdateSchema,
    params: ['recipeId'],
    execute: ({ userId, params, data }) => updateRecipe(userId, params.recipeId!, data)
  }),
  defineHandler({ name: RecipeHandlers.delete, params: ['recipeId'], execute: ({ userId, params }) => deleteRecipe(userId, params.recipeId!) }),
  defineHandler({
    name: RecipeHandlers.publish,
    params: ['recipeId', 'authorName'],
    execute: ({ userId, params }) => publishRecipe(userId, params.recipeId!, params.authorName!)
  }),
  defineHandler({
    name: RecipeHandlers.unpublish,
    params: ['recipeId'],
    execute: ({ userId, params }) => unpublishRecipe(userId, params.recipeId!)
  }),
  defineHandler({
    name: RecipeHandlers.adapt,
    schema: recipeAdaptationSchema,
    execute: ({ userId, data }) => adaptRecipe(userId, data.recipeId)
  }),
  defineHandler({ name: RecipeHandlers.communityList, requiresUser: false, execute: () => listCommunityRecipes() }),
  defineHandler({
    name: RecipeHandlers.communityDetail,
    params: ['recipeId'],
    requiresUser: false,
    execute: ({ params }) => getCommunityRecipe(params.recipeId!)
  })
];
