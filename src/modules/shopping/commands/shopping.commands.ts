import type { Arg } from '../../../core/commands/command-bus.js';
import type { ShoppingService } from '../shopping.service.js';

/** Comandos del módulo shopping. Lista de compras. */
export const shoppingCommands = (s: { shopping: ShoppingService }) => ({
  'shopping.patchItem': (c: { userId: string; listId: string; itemId: string; patch: Arg<ShoppingService['patchItem'], 3> }) => s.shopping.patchItem(c.userId, c.listId, c.itemId, c.patch),
  'shopping.removeItem': (c: { userId: string; listId: string; itemId: string }) => s.shopping.removeItem(c.userId, c.listId, c.itemId),
  'shopping.removeRecipe': (c: { userId: string; listId: string; recipeId: string }) => s.shopping.removeRecipe(c.userId, c.listId, c.recipeId),
  'shopping.swap': (c: { userId: string; listId: string; itemId: string; suggestionId: string }) => s.shopping.swap(c.userId, c.listId, c.itemId, c.suggestionId),
  'shopping.addItems': (c: { userId: string; tz: string; items: Arg<ShoppingService['addItems'], 2> }) => s.shopping.addItems(c.userId, c.tz, c.items),
  'shopping.addRecipe': (c: { userId: string; tz: string; input: Arg<ShoppingService['addRecipe'], 2> }) => s.shopping.addRecipe(c.userId, c.tz, c.input),
  'shopping.share': (c: { userId: string; listId: string }) => s.shopping.share(c.userId, c.listId),
  'shopping.checkout': (c: { userId: string; tz: string; listId: string; input: Arg<ShoppingService['checkout'], 3> }) => s.shopping.checkout(c.userId, c.tz, c.listId, c.input),
});
