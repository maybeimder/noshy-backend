import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AuthoringController } from './authoring.controller.js';
import { CreateRecipeBody, MyRecipeParams, MyRecipesQuery, PatchRecipeBody } from './authoring.dto.js';

export async function authoringRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const c = new AuthoringController(app.container);
  const done = [app.authenticate, app.requireOnboarding];
  const tags = ['Crear receta'];

  r.post('/me/recipes', { preHandler: [...done, app.idempotent], schema: { tags, summary: 'Crear borrador', body: CreateRecipeBody } }, (req, rep) => c.create(req, rep));
  r.patch('/me/recipes/:recipeId', { preHandler: done, schema: { tags, summary: 'Autoguardar y recalcular macros', params: MyRecipeParams, body: PatchRecipeBody } }, (req) => c.patch(req));
  r.post('/me/recipes/:recipeId/publish', { preHandler: [...done, app.idempotent], schema: { tags, summary: 'Publicar en la comunidad', params: MyRecipeParams } }, (req) => c.publish(req));
  r.post('/me/recipes/:recipeId/unpublish', { preHandler: done, schema: { tags, summary: 'Sacar de la comunidad (vuelve a borrador)', params: MyRecipeParams } }, (req) => c.unpublish(req));
  r.delete('/me/recipes/:recipeId', { preHandler: done, schema: { tags, summary: 'Borrar una receta propia', params: MyRecipeParams } }, (req, rep) => c.remove(req, rep));
  r.get('/me/recipes', { preHandler: done, schema: { tags, summary: 'Mis recetas', querystring: MyRecipesQuery } }, (req) => c.mine(req));
}
