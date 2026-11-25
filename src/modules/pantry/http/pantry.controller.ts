import type { z } from 'zod';
import type { Container } from '../../../container.js';
import type { Req, Rep } from '../../../core/shared/request.js';
import { ok } from '../../../core/shared/http.js';
import type { BulkBody, PantryAddBody, PantryDeleteQuery, PantryItemParams, PantryListQuery, PantryPatchBody, SuggestionsQuery } from './pantry.dto.js';

export class PantryController {
  constructor(private readonly c: Container) {}

  overview = async (req: Req) => ok(await this.c.services.pantry.overview(req.user.id, req.tz));

  list = async (req: Req<{ Querystring: z.infer<typeof PantryListQuery> }>) => this.c.services.pantry.list(req.user.id, req.query);

  add = async (req: Req<{ Body: z.infer<typeof PantryAddBody> }>, reply: Rep) => {
    reply.code(201);
    return ok(await this.c.commands.execute('pantry.add', { userId: req.user.id, tz: req.tz, body: req.body }));
  };

  patch = async (req: Req<{ Params: z.infer<typeof PantryItemParams>; Body: z.infer<typeof PantryPatchBody> }>) =>
    ok(await this.c.commands.execute('pantry.patch', { userId: req.user.id, itemId: req.params.itemId, patch: req.body }));

  remove = async (req: Req<{ Params: z.infer<typeof PantryItemParams>; Querystring: z.infer<typeof PantryDeleteQuery> }>, reply: Rep) => {
    await this.c.commands.execute('pantry.remove', { userId: req.user.id, itemId: req.params.itemId, addToShoppingList: req.query.addToShoppingList === 'true' });
    return reply.code(204).send();
  };

  suggestions = async (req: Req<{ Querystring: z.infer<typeof SuggestionsQuery> }>) => ok(await this.c.services.pantrySetup.suggestions(req.user.id, req.query.limit));

  bulk = async (req: Req<{ Body: z.infer<typeof BulkBody> }>) => ok(await this.c.commands.execute('pantry.bulkSetup', { userId: req.user.id, tz: req.tz, input: req.body }));
}
