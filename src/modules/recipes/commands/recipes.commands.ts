import type { RecipesService } from '../recipes.service.js';

/** Comandos del módulo recipes. Adaptar, guardar y me gusta. */
export const recipesCommands = (s: { recipes: RecipesService }) => ({
  'recipes.applyProposal': (c: { userId: string; recipeId: string; proposalId: string }) => s.recipes.applyProposal(c.userId, c.recipeId, c.proposalId),
  'recipes.setSaved': (c: { userId: string; recipeId: string; saved: boolean }) => s.recipes.setSaved(c.userId, c.recipeId, c.saved),
  'recipes.setLiked': (c: { userId: string; recipeId: string; liked: boolean }) => s.recipes.setLiked(c.userId, c.recipeId, c.liked),
});
