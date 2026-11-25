import type { Arg } from '../../../core/commands/command-bus.js';
import type { MenusService } from '../menus.service.js';
import type { ShoppingService } from '../../shopping/shopping.service.js';

/** Comandos del módulo menus. Mi semana. */
export const menusCommands = (s: { menus: MenusService; shopping: ShoppingService }) => ({
  'menus.retry': (c: { userId: string; menuId: string; tz: string }) => s.menus.retry(c.userId, c.menuId, c.tz),
  'menus.regenerate': (c: { userId: string; menuId: string; tz: string }) => s.menus.regenerate(c.userId, c.menuId, c.tz),
  'menus.addEntry': (c: { userId: string; menuId: string; input: Arg<MenusService['addEntry'], 2> }) => s.menus.addEntry(c.userId, c.menuId, c.input),
  'menus.patchEntry': (c: { userId: string; menuId: string; entryId: string; patch: Arg<MenusService['patchEntry'], 3> }) => s.menus.patchEntry(c.userId, c.menuId, c.entryId, c.patch),
  'menus.removeEntry': (c: { userId: string; menuId: string; entryId: string }) => s.menus.removeEntry(c.userId, c.menuId, c.entryId),
  'menus.toShoppingList': (c: { userId: string; tz: string; menuId: string }) => s.menus.toShoppingList(c.userId, c.tz, c.menuId, s.shopping),
});
