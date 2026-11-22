import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { CatalogController } from './catalog.controller.js';
import { IngredientSearchQuery } from './catalog.dto.js';

export async function catalogRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const c = new CatalogController(app.container);

  r.get('/catalog/ingredients/search', { preHandler: [app.authenticate], schema: { tags: ['Catálogo'], summary: 'Buscar ingredientes', querystring: IngredientSearchQuery } }, (req) =>
    c.searchIngredients(req),
  );
}
