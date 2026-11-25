import type { z } from 'zod';
import type { Container } from '../../../container.js';
import type { Req } from '../../../core/shared/request.js';
import { ok } from '../../../core/shared/http.js';
import type { AddMenuEntryBody, MenuEntryParams, MenuParams, PatchMenuEntryBody } from './menus.dto.js';

export class MenusController {
  constructor(private readonly c: Container) {}

  current = async (req: Req) => ok(await this.c.services.menus.currentWeek(req.user.id, req.tz));

  get = async (req: Req<{ Params: z.infer<typeof MenuParams> }>) => ok(await this.c.services.menus.get(req.user.id, req.params.menuId));

  retry = async (req: Req<{ Params: z.infer<typeof MenuParams> }>) => ok(await this.c.services.menus.retry(req.user.id, req.params.menuId, req.tz));

  regenerate = async (req: Req<{ Params: z.infer<typeof MenuParams> }>) => ok(await this.c.services.menus.regenerate(req.user.id, req.params.menuId, req.tz));

  addEntry = async (req: Req<{ Params: z.infer<typeof MenuParams>; Body: z.infer<typeof AddMenuEntryBody> }>) =>
    ok(await this.c.services.menus.addEntry(req.user.id, req.params.menuId, req.body));

  patchEntry = async (req: Req<{ Params: z.infer<typeof MenuEntryParams>; Body: z.infer<typeof PatchMenuEntryBody> }>) =>
    ok(await this.c.services.menus.patchEntry(req.user.id, req.params.menuId, req.params.entryId, req.body));

  removeEntry = async (req: Req<{ Params: z.infer<typeof MenuEntryParams> }>) => ok(await this.c.services.menus.removeEntry(req.user.id, req.params.menuId, req.params.entryId));

  toShoppingList = async (req: Req<{ Params: z.infer<typeof MenuParams> }>) =>
    ok(await this.c.services.menus.toShoppingList(req.user.id, req.tz, req.params.menuId, this.c.services.shopping));
}
