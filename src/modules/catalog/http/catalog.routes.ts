import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { CatalogController } from './catalog.controller.js';
import { IngredientParams, IngredientSearchQuery, ProductsQuery } from './catalog.dto.js';

export async function catalogRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const c = new CatalogController(app.container);

  r.get('/catalog/ingredients/search', { preHandler: [app.authenticate], schema: { tags: ['Catálogo'], summary: 'Buscar ingredientes', querystring: IngredientSearchQuery } }, (req) =>
    c.searchIngredients(req),
  );
  r.get(
    '/catalog/ingredients/:ingredientId/products',
    { preHandler: [app.authenticate], schema: { tags: ['Catálogo'], summary: 'Productos y precios de un ingrediente', params: IngredientParams, querystring: ProductsQuery } },
    (req) => c.products(req as never),
  );
}
