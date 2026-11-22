import type { Container } from '../../../container.js';
import { EventObserver } from '../../../core/events/observer.js';

/**
 * La lista de compras sigue al menú y a la despensa:
 * - `menu.generated` arma la lista con lo que falta para las recetas.
 * - «Mi semana»: agregar, cambiar o quitar una receta del menú actualiza la lista.
 * - «Se acabó» en la despensa con «agregar a la lista» → el ingrediente pasa a la lista.
 */
export class ShoppingObserver extends EventObserver {
  readonly name = 'shopping';

  constructor(c: Container) {
    super();
    const shopping = c.services.shopping;
    const tzOf = async (userId: string) => (await c.repos.users.findById(userId))?.timezone ?? 'America/Bogota';
    const stillInMenu = async (menuId: string, recipeId: string) => (await c.repos.menus.entries(menuId)).some((x) => x.recipeId === recipeId);

    this.on('menu.generated', async (e) => {
      const tz = await tzOf(e.payload.userId);
      await c.pg.db.transaction(async (tx) => {
        for (const recipeId of e.payload.recipeIds) {
          await shopping.addRecipeTx(tx, e.payload.userId, tz, { recipeId }, { failIfPresent: false });
        }
      });
    });

    this.on('menu.entry_added', async (e) => {
      const tz = await tzOf(e.payload.userId);
      await c.pg.db.transaction((tx) => shopping.addRecipeTx(tx, e.payload.userId, tz, { recipeId: e.payload.recipeId, servings: e.payload.servings }, { failIfPresent: false }));
    });

    this.on('menu.entry_changed', async (e) => {
      const tz = await tzOf(e.payload.userId);
      const keep = await stillInMenu(e.payload.menuId, e.payload.fromRecipeId);
      await c.pg.db.transaction(async (tx) => {
        if (!keep) await shopping.removeRecipeTx(tx, e.payload.userId, e.payload.fromRecipeId);
        await shopping.addRecipeTx(tx, e.payload.userId, tz, { recipeId: e.payload.toRecipeId, servings: e.payload.servings }, { failIfPresent: false });
      });
    });

    this.on('menu.entry_removed', async (e) => {
      if (await stillInMenu(e.payload.menuId, e.payload.recipeId)) return;
      await c.pg.db.transaction((tx) => shopping.removeRecipeTx(tx, e.payload.userId, e.payload.recipeId));
    });

    this.on('pantry.item_removed', async (e) => {
      if (!e.payload.addToShoppingList) return;
      await shopping.addItems(e.payload.userId, await tzOf(e.payload.userId), [{ ingredientId: e.payload.ingredientId }]);
    });
  }
}
