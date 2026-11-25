import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { MenusController } from './menus.controller.js';
import { AddMenuEntryBody, MenuEntryParams, MenuParams, PatchMenuEntryBody } from './menus.dto.js';

export async function menusRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const c = new MenusController(app.container);
  const done = [app.authenticate, app.requireOnboarding];
  const tags = ['Menús · Mi semana'];

  r.get('/me/menus/current', { preHandler: done, schema: { tags, summary: 'Mi semana: días con sus recetas' } }, (req) => c.current(req));
  r.get('/me/menus/:menuId', { preHandler: done, schema: { tags, summary: 'Menú semanal y su estado de generación', params: MenuParams } }, (req) => c.get(req));
  r.post('/me/menus/:menuId/retry', { preHandler: done, schema: { tags, summary: 'Reintentar un menú que falló', params: MenuParams } }, (req) => c.retry(req));
  r.post('/me/menus/:menuId/regenerate', { preHandler: done, schema: { tags, summary: 'Armar otra semana (de hoy en adelante)', params: MenuParams } }, (req) => c.regenerate(req));
  r.post('/me/menus/:menuId/entries', { preHandler: done, schema: { tags, summary: 'Agregar receta a un día', params: MenuParams, body: AddMenuEntryBody } }, (req) => c.addEntry(req));
  r.patch('/me/menus/:menuId/entries/:entryId', { preHandler: done, schema: { tags, summary: 'Mover o cambiar una receta del menú', params: MenuEntryParams, body: PatchMenuEntryBody } }, (req) =>
    c.patchEntry(req),
  );
  r.delete('/me/menus/:menuId/entries/:entryId', { preHandler: done, schema: { tags, summary: 'Quitar una receta del menú', params: MenuEntryParams } }, (req) => c.removeEntry(req));
  r.post('/me/menus/:menuId/shopping-list', { preHandler: done, schema: { tags, summary: 'Generar lista de compras desde el menú', params: MenuParams } }, (req) => c.toShoppingList(req));
}
