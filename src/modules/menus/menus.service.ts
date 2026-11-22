import type { Db } from '../../infrastructure/database/postgres/postgres.client.js';
import type { Outbox } from '../../core/events/outbox.js';
import type { MenusRepository } from './menus.repository.js';
import type { RecommendationsService } from '../recipes/recommendations.service.js';
import type { RecipesService } from '../recipes/recipes.service.js';
import { Errors, field } from '../../core/shared/errors.js';
import type { MealSlotId } from '../../core/domain/catalog.js';
import type { ShoppingService } from '../shopping/shopping.service.js';
import { newId } from '../../core/shared/ids.js';
import { addDays, isIsoDate, localDate, weekStart } from '../../core/shared/time.js';

const MENU_SIZE = 5;

/** Menú semanal: lo genera el observer `menus` con `onboarding.completed` y emite `menu.generated`. */
export class MenusService {
  constructor(
    private readonly db: Db,
    private readonly repo: MenusRepository,
    private readonly recommendations: RecommendationsService,
    private readonly recipes: RecipesService,
    private readonly outbox: Outbox,
  ) {}

  async generate(userId: string, menuId: string, tz: string) {
    const menu = await this.repo.byId(userId, menuId);
    if (!menu || menu.status === 'ready') return;
    try {
      await this.repo.update(this.db, menuId, { progress: { stage: 'dishes', percent: 40 } });
      const ranked = await this.recommendations.ranked(userId, { slot: 'lunch' });
      const picks = ranked.slice(0, MENU_SIZE).map((r) => r.e.recipe);
      const start = localDate(new Date(), tz);
      await this.repo.update(this.db, menuId, { progress: { stage: 'shoppingList', percent: 75 } });
      await this.db.transaction(async (tx) => {
        await this.repo.insertEntries(
          tx,
          picks.map((r, i) => ({ id: newId('menuEntry'), menuId, localDate: addDays(start, i), slot: 'lunch', recipeId: r.id, servings: 2 })),
        );
        await this.repo.update(tx, menuId, { status: 'ready', readyAt: new Date(), progress: { stage: 'shoppingList', percent: 100 } });
        await this.outbox.record(tx, 'menu.generated', { userId, menuId, weekStart: menu.weekStart, recipeIds: picks.map((r) => r.id) });
      });
      this.outbox.kick();
    } catch (err) {
      await this.repo.update(this.db, menuId, { status: 'failed' });
      throw err;
    }
  }

  async get(userId: string, menuId: string) {
    const menu = await this.repo.byId(userId, menuId);
    if (!menu) throw Errors.notFound('Ese menú no existe.');
    const entries = await this.repo.entries(menuId);
    const cards = entries.length ? await this.recipes.cards(userId, entries.map((e) => e.recipeId)) : [];
    return {
      id: menu.id,
      status: menu.status,
      progress: menu.progress,
      weekStart: menu.weekStart,
      entries: entries.map((e) => ({ id: e.id, date: e.localDate, slot: e.slot, servings: e.servings, recipe: cards.find((c) => c.id === e.recipeId) ?? null })),
    };
  }

  async retry(userId: string, menuId: string, tz: string) {
    const menu = await this.repo.byId(userId, menuId);
    if (!menu) throw Errors.notFound('Ese menú no existe.');
    if (menu.status !== 'failed') throw Errors.conflict('MENU_NOT_FAILED', 'El menú no falló.');
    await this.repo.update(this.db, menuId, { status: 'generating', progress: { stage: 'restrictions', percent: 0 } });
    void this.generate(userId, menuId, tz);
    return this.get(userId, menuId);
  }

  // ---------- Mi semana ----------

  /** Menú de la semana: tira de días con sus franjas. Si no hay menú esta semana, devuelve el último. */
  async currentWeek(userId: string, tz: string) {
    const menu = await this.repo.latest(userId);
    if (!menu) throw Errors.notFound('Todavía no tienes menú. Termina el onboarding o pídele uno al chef.');
    const base = await this.get(userId, menu.id);
    const start = weekStart(localDate(new Date(), tz));
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((date) => ({
      date,
      entries: base.entries.filter((e) => e.date === date),
    }));
    const outside = base.entries.filter((e) => !days.some((d) => d.date === e.date));
    return { ...base, days, ...(outside.length ? { otherEntries: outside } : {}) };
  }

  private async entryOrThrow(userId: string, menuId: string, entryId: string) {
    const menu = await this.repo.byId(userId, menuId);
    if (!menu) throw Errors.notFound('Ese menú no existe.');
    const entry = await this.repo.entry(menuId, entryId);
    if (!entry) throw Errors.notFound('Esa receta no está en el menú.');
    return { menu, entry };
  }

  private async assertCookable(userId: string, recipeId: string) {
    const r = await this.recipes.resolvedFor(userId, recipeId, 1).catch(() => null);
    if (!r) throw Errors.validation([field('recipeId', 'INVALID_OPTION', 'Esa receta no existe.')]);
    if (!r.evaluated.evaluation.compatibility.ok) throw Errors.unprocessable('RECIPE_NOT_COMPATIBLE', 'Esa receta choca con tus restricciones.');
  }

  async addEntry(userId: string, menuId: string, input: { date: string; slot: MealSlotId; recipeId: string; servings?: number }) {
    const menu = await this.repo.byId(userId, menuId);
    if (!menu) throw Errors.notFound('Ese menú no existe.');
    if (!isIsoDate(input.date)) throw Errors.validation([field('date', 'INVALID_DATE', 'Usa el formato YYYY-MM-DD.')]);
    await this.assertCookable(userId, input.recipeId);
    const id = newId('menuEntry');
    const servings = input.servings ?? 2;
    await this.db.transaction(async (tx) => {
      await this.repo.insertEntries(tx, [{ id, menuId, localDate: input.date, slot: input.slot, recipeId: input.recipeId, servings }]);
      await this.outbox.record(tx, 'menu.entry_added', { userId, menuId, entryId: id, recipeId: input.recipeId, servings });
    });
    this.outbox.kick();
    return this.get(userId, menuId);
  }

  /** Mover a otro día o franja, cambiar la receta o las porciones. Cambiar receta actualiza la lista por evento. */
  async patchEntry(userId: string, menuId: string, entryId: string, patch: { date?: string; slot?: MealSlotId; recipeId?: string; servings?: number }) {
    const { entry } = await this.entryOrThrow(userId, menuId, entryId);
    if (patch.date && !isIsoDate(patch.date)) throw Errors.validation([field('date', 'INVALID_DATE', 'Usa el formato YYYY-MM-DD.')]);
    if (patch.recipeId && patch.recipeId !== entry.recipeId) await this.assertCookable(userId, patch.recipeId);
    await this.db.transaction(async (tx) => {
      const updated = await this.repo.updateEntry(tx, entryId, {
        ...(patch.date ? { localDate: patch.date } : {}),
        ...(patch.slot ? { slot: patch.slot } : {}),
        ...(patch.recipeId ? { recipeId: patch.recipeId } : {}),
        ...(patch.servings ? { servings: patch.servings } : {}),
      });
      if (patch.recipeId && patch.recipeId !== entry.recipeId) {
        await this.outbox.record(tx, 'menu.entry_changed', { userId, menuId, entryId, fromRecipeId: entry.recipeId, toRecipeId: patch.recipeId, servings: updated.servings });
      }
    });
    this.outbox.kick();
    return this.get(userId, menuId);
  }

  async removeEntry(userId: string, menuId: string, entryId: string) {
    const { entry } = await this.entryOrThrow(userId, menuId, entryId);
    await this.db.transaction(async (tx) => {
      await this.repo.deleteEntry(tx, entryId);
      await this.outbox.record(tx, 'menu.entry_removed', { userId, menuId, entryId, recipeId: entry.recipeId });
    });
    this.outbox.kick();
    return this.get(userId, menuId);
  }

  /** «Generar lista de compras»: agrega a la lista lo que falta de todas las recetas del menú. */
  async toShoppingList(userId: string, tz: string, menuId: string, shopping: ShoppingService) {
    const menu = await this.repo.byId(userId, menuId);
    if (!menu) throw Errors.notFound('Ese menú no existe.');
    const entries = await this.repo.entries(menuId);
    const totals = { added: 0, merged: 0, skippedInPantry: 0, recipes: 0 };
    await this.db.transaction(async (tx) => {
      for (const e of entries) {
        const r = await shopping.addRecipeTx(tx, userId, tz, { recipeId: e.recipeId, servings: e.servings }, { failIfPresent: false });
        totals.added += r.added;
        totals.merged += r.merged;
        totals.skippedInPantry += r.skippedInPantry;
        totals.recipes++;
      }
    });
    this.outbox.kick();
    return totals;
  }
}
