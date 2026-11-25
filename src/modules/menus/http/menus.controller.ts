import type { z } from 'zod';
import type { Container } from '../../../container.js';
import type { Req } from '../../../core/shared/request.js';
import { ok } from '../../../core/shared/http.js';
import type { AddMenuEntryBody, MenuEntryParams, MenuParams, PatchMenuEntryBody } from './menus.dto.js';

export class MenusController {
  constructor(private readonly c: Container) {}

  current = async (req: Req) => ok(await this.c.services.menus.currentWeek(req.user.id, req.tz));

  get = async (req: Req<{ Params: z.infer<typeof MenuParams> }>) => ok(await this.c.services.menus.get(req.user.id, req.params.menuId));

  retry = async (req: Req<{ Params: z.infer<typeof MenuParams> }>) => ok(await this.c.commands.execute('menus.retry', { userId: req.user.id, menuId: req.params.menuId, tz: req.tz }));

  regenerate = async (req: Req<{ Params: z.infer<typeof MenuParams> }>) => ok(await this.c.commands.execute('menus.regenerate', { userId: req.user.id, menuId: req.params.menuId, tz: req.tz }));

  addEntry = async (req: Req<{ Params: z.infer<typeof MenuParams>; Body: z.infer<typeof AddMenuEntryBody> }>) =>
    ok(await this.c.commands.execute('menus.addEntry', { userId: req.user.id, menuId: req.params.menuId, input: req.body }));

  patchEntry = async (req: Req<{ Params: z.infer<typeof MenuEntryParams>; Body: z.infer<typeof PatchMenuEntryBody> }>) =>
    ok(await this.c.commands.execute('menus.patchEntry', { userId: req.user.id, menuId: req.params.menuId, entryId: req.params.entryId, patch: req.body }));

  removeEntry = async (req: Req<{ Params: z.infer<typeof MenuEntryParams> }>) => ok(await this.c.commands.execute('menus.removeEntry', { userId: req.user.id, menuId: req.params.menuId, entryId: req.params.entryId }));

  toShoppingList = async (req: Req<{ Params: z.infer<typeof MenuParams> }>) =>
    ok(await this.c.commands.execute('menus.toShoppingList', { userId: req.user.id, tz: req.tz, menuId: req.params.menuId }));
}
