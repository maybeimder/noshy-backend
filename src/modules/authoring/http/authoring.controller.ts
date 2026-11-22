import type { z } from 'zod';
import type { Container } from '../../../container.js';
import type { Req, Rep } from '../../../core/shared/request.js';
import { ok } from '../../../core/shared/http.js';
import type { CreateRecipeBody, MyRecipeParams, MyRecipesQuery, PatchRecipeBody } from './authoring.dto.js';

export class AuthoringController {
  constructor(private readonly c: Container) {}

  create = async (req: Req<{ Body: z.infer<typeof CreateRecipeBody> }>, reply: Rep) => {
    reply.code(201);
    return ok(await this.c.services.authoring.create(req.user.id, req.body));
  };

  patch = async (req: Req<{ Params: z.infer<typeof MyRecipeParams>; Body: z.infer<typeof PatchRecipeBody> }>) => {
    const ifMatch = req.headers['if-match'];
    return ok(await this.c.services.authoring.patch(req.user.id, req.params.recipeId, req.body, Array.isArray(ifMatch) ? ifMatch[0] : ifMatch));
  };

  publish = async (req: Req<{ Params: z.infer<typeof MyRecipeParams> }>) => ok(await this.c.services.authoring.publish(req.user.id, req.params.recipeId));

  mine = async (req: Req<{ Querystring: z.infer<typeof MyRecipesQuery> }>) => this.c.services.authoring.mine(req.user.id, req.query);
}
