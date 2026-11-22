import type { z } from 'zod';
import type { Container } from '../../../container.js';
import type { Req } from '../../../core/shared/request.js';
import { ok } from '../../../core/shared/http.js';
import type { IngredientSearchQuery } from './catalog.dto.js';

export class CatalogController {
  constructor(private readonly c: Container) {}

  searchIngredients = async (req: Req<{ Querystring: z.infer<typeof IngredientSearchQuery> }>) =>
    ok(await this.c.services.ingredientSearch.search(req.user.id, req.query.q, req.query.limit));
}
