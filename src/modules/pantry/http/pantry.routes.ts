import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PantryController } from './pantry.controller.js';
import { BulkBody, PantryAddBody, PantryDeleteQuery, PantryItemParams, PantryListQuery, PantryPatchBody, SuggestionsQuery } from './pantry.dto.js';

export async function pantryRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const c = new PantryController(app.container);
  const done = [app.authenticate, app.requireOnboarding];
  const tags = ['Mi despensa'];

  r.get('/me/pantry/overview', { preHandler: done, schema: { tags, summary: 'Resumen de la despensa' } }, (req) => c.overview(req));
  r.get('/me/pantry', { preHandler: done, schema: { tags, summary: 'Ingredientes de la despensa', querystring: PantryListQuery } }, (req) => c.list(req));
  r.post('/me/pantry/items', { preHandler: done, schema: { tags, summary: 'Agregar un ingrediente a mano', body: PantryAddBody } }, (req, rep) => c.add(req, rep));
  r.patch('/me/pantry/:itemId', { preHandler: done, schema: { tags, summary: 'Ajustar nivel, lugar o vencimiento', params: PantryItemParams, body: PantryPatchBody } }, (req) => c.patch(req));
  r.delete('/me/pantry/:itemId', { preHandler: done, schema: { tags, summary: '«Se acabó»', params: PantryItemParams, querystring: PantryDeleteQuery } }, (req, rep) => c.remove(req, rep));

  const setupTags = ['Tu despensa (onboarding)'];
  r.get('/me/pantry/suggestions', { preHandler: done, schema: { tags: setupTags, summary: 'Lista sugerida según tus platos', querystring: SuggestionsQuery } }, (req) => c.suggestions(req));
  r.post('/me/pantry/bulk', { preHandler: [...done, app.idempotent], schema: { tags: setupTags, summary: 'Guardar respuestas de la despensa', body: BulkBody } }, (req) => c.bulk(req));
}
