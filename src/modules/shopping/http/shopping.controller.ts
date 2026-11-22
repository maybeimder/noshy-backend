import type { z } from 'zod';
import type { Container } from '../../../container.js';
import type { Req } from '../../../core/shared/request.js';
import { ok } from '../../../core/shared/http.js';
import type { AddItemsBody, AddRecipeBody, CheckoutBody, CurrentListQuery, ItemParams, ListParams, PatchItemBody, ShareTokenParams, SwapBody } from './shopping.dto.js';

export class ShoppingController {
  constructor(private readonly c: Container) {}

  current = async (req: Req<{ Querystring: z.infer<typeof CurrentListQuery> }>) => ok(await this.c.services.shopping.current(req.user.id, req.query));

  patchItem = async (req: Req<{ Params: z.infer<typeof ItemParams>; Body: z.infer<typeof PatchItemBody> }>) =>
    ok(await this.c.services.shopping.patchItem(req.user.id, req.params.listId, req.params.itemId, req.body));

  swap = async (req: Req<{ Params: z.infer<typeof ItemParams>; Body: z.infer<typeof SwapBody> }>) =>
    ok(await this.c.services.shopping.swap(req.user.id, req.params.listId, req.params.itemId, req.body.suggestionId));

  addItems = async (req: Req<{ Body: z.infer<typeof AddItemsBody> }>) => ok(await this.c.services.shopping.addItems(req.user.id, req.tz, req.body.items));

  addRecipe = async (req: Req<{ Body: z.infer<typeof AddRecipeBody> }>) => ok(await this.c.services.shopping.addRecipe(req.user.id, req.tz, req.body));

  share = async (req: Req<{ Params: z.infer<typeof ListParams> }>) => ok(await this.c.services.shopping.share(req.user.id, req.params.listId));

  checkout = async (req: Req<{ Params: z.infer<typeof ListParams>; Body: z.infer<typeof CheckoutBody> }>) =>
    ok(await this.c.services.shopping.checkout(req.user.id, req.tz, req.params.listId, req.body));

  sharedList = async (req: Req<{ Params: z.infer<typeof ShareTokenParams> }>) => ok(await this.c.services.shopping.sharedView(req.params.token));
}
