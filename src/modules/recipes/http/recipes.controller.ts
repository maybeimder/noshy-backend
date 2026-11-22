import type { z } from 'zod';
import type { Container } from '../../../container.js';
import type { Req, Rep } from '../../../core/shared/request.js';
import { ok } from '../../../core/shared/http.js';
import type { RecipeIdParam } from '../../../core/shared/common.dto.js';
import type { ApplyAdaptationBody, CookedQuery, EstimateBody, RecipeDetailQuery } from './recipes.dto.js';

export class RecipesController {
  constructor(private readonly c: Container) {}

  detail = async (req: Req<{ Params: z.infer<typeof RecipeIdParam>; Querystring: z.infer<typeof RecipeDetailQuery> }>) =>
    ok(await this.c.services.recipes.detail(req.user.id, req.params.recipeId, { servings: req.query.servings, adapted: req.query.adapted !== 'false' }));

  applyAdaptation = async (req: Req<{ Params: z.infer<typeof RecipeIdParam>; Body: z.infer<typeof ApplyAdaptationBody> }>, reply: Rep) => {
    reply.code(201);
    return ok(await this.c.services.recipes.applyProposal(req.user.id, req.params.recipeId, req.body.proposalId));
  };

  save = async (req: Req<{ Params: z.infer<typeof RecipeIdParam> }>, reply: Rep) => {
    await this.c.services.recipes.setSaved(req.user.id, req.params.recipeId, true);
    return reply.code(204).send();
  };

  unsave = async (req: Req<{ Params: z.infer<typeof RecipeIdParam> }>, reply: Rep) => {
    await this.c.services.recipes.setSaved(req.user.id, req.params.recipeId, false);
    return reply.code(204).send();
  };

  like = async (req: Req<{ Params: z.infer<typeof RecipeIdParam> }>) => ok(await this.c.services.recipes.setLiked(req.user.id, req.params.recipeId, true));

  unlike = async (req: Req<{ Params: z.infer<typeof RecipeIdParam> }>) => ok(await this.c.services.recipes.setLiked(req.user.id, req.params.recipeId, false));

  cooked = async (req: Req<{ Querystring: z.infer<typeof CookedQuery> }>) => this.c.services.kitchen.cooked(req.user.id, req.query);

  estimate = async (req: Req<{ Body: z.infer<typeof EstimateBody> }>) => ok(await this.c.services.nutrition.estimate(req.body.text));
}
