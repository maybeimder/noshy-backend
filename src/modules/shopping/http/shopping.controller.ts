import type { z } from 'zod';
import type { Container } from '../../../container.js';
import type { Req, Rep } from '../../../core/shared/request.js';
import { ok } from '../../../core/shared/http.js';
import type { AddItemsBody, AddRecipeBody, CheckoutBody, CurrentListQuery, ItemParams, ListParams, ListRecipeParams, PatchItemBody, ShareTokenParams, SwapBody } from './shopping.dto.js';

export class ShoppingController {
  constructor(private readonly c: Container) {}

  current = async (req: Req<{ Querystring: z.infer<typeof CurrentListQuery> }>) => ok(await this.c.services.shopping.current(req.user.id, req.query));

  patchItem = async (req: Req<{ Params: z.infer<typeof ItemParams>; Body: z.infer<typeof PatchItemBody> }>) =>
    ok(await this.c.commands.execute('shopping.patchItem', { userId: req.user.id, listId: req.params.listId, itemId: req.params.itemId, patch: req.body }));

  removeItem = async (req: Req<{ Params: z.infer<typeof ItemParams> }>, reply: Rep) => {
    await this.c.commands.execute('shopping.removeItem', { userId: req.user.id, listId: req.params.listId, itemId: req.params.itemId });
    return reply.code(204).send();
  };

  removeRecipe = async (req: Req<{ Params: z.infer<typeof ListRecipeParams> }>) => ok(await this.c.commands.execute('shopping.removeRecipe', { userId: req.user.id, listId: req.params.listId, recipeId: req.params.recipeId }));

  swap = async (req: Req<{ Params: z.infer<typeof ItemParams>; Body: z.infer<typeof SwapBody> }>) =>
    ok(await this.c.commands.execute('shopping.swap', { userId: req.user.id, listId: req.params.listId, itemId: req.params.itemId, suggestionId: req.body.suggestionId }));

  addItems = async (req: Req<{ Body: z.infer<typeof AddItemsBody> }>) => ok(await this.c.commands.execute('shopping.addItems', { userId: req.user.id, tz: req.tz, items: req.body.items }));

  addRecipe = async (req: Req<{ Body: z.infer<typeof AddRecipeBody> }>) => ok(await this.c.commands.execute('shopping.addRecipe', { userId: req.user.id, tz: req.tz, input: req.body }));

  share = async (req: Req<{ Params: z.infer<typeof ListParams> }>) => ok(await this.c.commands.execute('shopping.share', { userId: req.user.id, listId: req.params.listId }));

  checkout = async (req: Req<{ Params: z.infer<typeof ListParams>; Body: z.infer<typeof CheckoutBody> }>) =>
    ok(await this.c.commands.execute('shopping.checkout', { userId: req.user.id, tz: req.tz, listId: req.params.listId, input: req.body }));

  sharedList = async (req: Req<{ Params: z.infer<typeof ShareTokenParams> }>) => ok(await this.c.services.shopping.sharedView(req.params.token));
}
