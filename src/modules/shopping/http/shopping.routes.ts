import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ShoppingController } from './shopping.controller.js';
import { AddItemsBody, AddRecipeBody, CheckoutBody, CurrentListQuery, ItemParams, ListParams, ListRecipeParams, PatchItemBody, ShareTokenParams, SwapBody } from './shopping.dto.js';

export async function shoppingRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const c = new ShoppingController(app.container);
  const done = [app.authenticate, app.requireOnboarding];
  const tags = ['Lista de compras'];

  r.get('/me/shopping-lists/current', { preHandler: done, schema: { tags, summary: 'Lista de compras de la semana', querystring: CurrentListQuery } }, (req) => c.current(req));
  r.post('/me/shopping-lists/current/items', { preHandler: done, schema: { tags, summary: 'Agregar ingredientes sueltos', body: AddItemsBody } }, (req) => c.addItems(req));
  r.post('/me/shopping-lists/current/recipes', { preHandler: done, schema: { tags, summary: 'Agregar lo que falta de una receta', body: AddRecipeBody } }, (req) => c.addRecipe(req));
  r.patch('/me/shopping-lists/:listId/items/:itemId', { preHandler: done, schema: { tags, summary: 'Marcar, cambiar cantidad o precio real', params: ItemParams, body: PatchItemBody } }, (req) => c.patchItem(req));
  r.delete('/me/shopping-lists/:listId/items/:itemId', { preHandler: done, schema: { tags, summary: 'Quitar de la lista', params: ItemParams } }, (req, rep) => c.removeItem(req, rep));
  r.delete('/me/shopping-lists/:listId/recipes/:recipeId', { preHandler: done, schema: { tags, summary: 'Sacar una receta de la lista', params: ListRecipeParams } }, (req) => c.removeRecipe(req));
  r.post('/me/shopping-lists/:listId/items/:itemId/swap', { preHandler: done, schema: { tags, summary: 'Aceptar el producto sugerido', params: ItemParams, body: SwapBody } }, (req) => c.swap(req));
  r.post('/me/shopping-lists/:listId/share', { preHandler: done, schema: { tags, summary: 'Compartir la lista', params: ListParams } }, (req) => c.share(req));
  r.post('/me/shopping-lists/:listId/checkout', { preHandler: [...done, app.idempotent], schema: { tags, summary: 'Terminar compra', params: ListParams, body: CheckoutBody } }, (req) => c.checkout(req));
  r.get('/shared/lists/:token', { schema: { tags, summary: 'Lista compartida (pública, sin login)', params: ShareTokenParams, security: [] } }, (req) => c.sharedList(req));
}
