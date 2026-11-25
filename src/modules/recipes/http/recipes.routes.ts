import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { RecipesController } from './recipes.controller.js';
import { Page, RecipeIdParam } from '../../../core/shared/common.dto.js';
import { ApplyAdaptationBody, CookedQuery, EstimateBody, RecipeDetailQuery, SharedRecipeParams } from './recipes.dto.js';

export async function recipesRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const c = new RecipesController(app.container);
  const done = [app.authenticate, app.requireOnboarding];
  const tags = ['Recetas'];

  r.get('/recipes/:recipeId', { preHandler: done, schema: { tags, summary: 'Detalle de receta personalizado', params: RecipeIdParam, querystring: RecipeDetailQuery } }, (req) => c.detail(req));
  r.post('/recipes/:recipeId/adaptations', { preHandler: done, schema: { tags, summary: 'Aplicar una adaptación propuesta', params: RecipeIdParam, body: ApplyAdaptationBody } }, (req, rep) => c.applyAdaptation(req, rep));
  r.get('/me/saved-recipes', { preHandler: done, schema: { tags, summary: 'Recetas guardadas', querystring: Page } }, (req) => c.saved(req));
  r.get('/shared/recipes/:key', { schema: { tags, summary: 'Receta compartida (pública, sin login)', params: SharedRecipeParams, security: [] } }, (req) => c.shared(req));
  r.put('/me/saved-recipes/:recipeId', { preHandler: done, schema: { tags, summary: 'Guardar receta', params: RecipeIdParam } }, (req, rep) => c.save(req, rep));
  r.delete('/me/saved-recipes/:recipeId', { preHandler: done, schema: { tags, summary: 'Quitar de guardadas', params: RecipeIdParam } }, (req, rep) => c.unsave(req, rep));
  r.put('/me/liked-recipes/:recipeId', { preHandler: done, schema: { tags, summary: 'Me gusta', params: RecipeIdParam } }, (req) => c.like(req));
  r.delete('/me/liked-recipes/:recipeId', { preHandler: done, schema: { tags, summary: 'Quitar me gusta', params: RecipeIdParam } }, (req) => c.unlike(req));
  r.get('/me/cooked-recipes', { preHandler: done, schema: { tags: ['Mi cocina'], summary: 'Recetas que has cocinado', querystring: CookedQuery } }, (req) => c.cooked(req));

  r.post('/nutrition/estimate', { preHandler: [app.authenticate], schema: { tags: ['Inicio'], summary: 'Estimar kcal de una comida en texto libre', body: EstimateBody } }, (req) => c.estimate(req));
}
