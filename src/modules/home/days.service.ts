import type { Db, Executor } from '../../infrastructure/database/postgres/postgres.client.js';
import type { Outbox } from '../../core/events/outbox.js';
import type { MealsRepository, MealLogRow } from './meals.repository.js';
import type { PreferencesService } from '../onboarding/preferences.service.js';
import type { RecipesService } from '../recipes/recipes.service.js';
import { currentSlot, slotDef, slotsFor, type SlotStatus } from '../../core/domain/meal-slots.js';
import { scaleMacros, sumMacros, type Macros } from '../../core/domain/nutrition.js';
import type { MealSlotId } from '../../core/domain/catalog.js';
import { Errors, field } from '../../core/shared/errors.js';
import { newId } from '../../core/shared/ids.js';
import { daysBetween, isIsoDate, localDate, localTime } from '../../core/shared/time.js';

export type LogMealInput =
  | { slot: MealSlotId; recipeId: string; servings?: number; skipped?: undefined; freeText?: undefined; nutrition?: undefined }
  | { slot: MealSlotId; freeText: string; nutrition: Macros; recipeId?: undefined; skipped?: undefined; servings?: number }
  | { slot: MealSlotId; skipped: true; recipeId?: undefined; freeText?: undefined; nutrition?: undefined; servings?: undefined };

/** El día nutricional: lo consumido contra la meta y las franjas con su estado. */
export class DaysService {
  constructor(
    private readonly db: Db,
    private readonly meals: MealsRepository,
    private readonly preferences: PreferencesService,
    private readonly recipes: RecipesService,
    private readonly outbox: Outbox,
  ) {}

  assertDate(date: string) {
    if (!isIsoDate(date)) throw Errors.validation([field('date', 'INVALID_DATE', 'Usa el formato YYYY-MM-DD.')]);
    if (Math.abs(daysBetween(date, new Date().toISOString().slice(0, 10))) > 366)
      throw Errors.validation([field('date', 'OUT_OF_RANGE', 'La fecha está a más de un año.')]);
  }

  async summary(userId: string, date: string, tz: string, exec: Executor = this.db) {
    this.assertDate(date);
    const [prefs, logs] = await Promise.all([this.preferences.getOrThrow(userId), this.meals.forDate(userId, date, exec)]);
    return this.build(date, tz, prefs.kitchen.mealsPerDay, prefs.nutritionTargets, logs);
  }

  build(date: string, tz: string, mealsPerDay: number, t: Macros, logs: MealLogRow[]) {
    const eaten = logs.filter((l) => !l.skipped);
    const consumed = sumMacros(eaten.map((l) => ({ kcal: l.kcal, proteinG: l.proteinG, carbsG: l.carbsG, fatG: l.fatG })));
    const now = new Date();
    const today = localDate(now, tz);
    const slots = slotsFor(mealsPerDay);
    const extra = [...new Set(logs.map((l) => l.slot as MealSlotId))].filter((s) => !slots.some((x) => x.slot === s)).map(slotDef);
    const all = [...slots, ...extra].sort((a, b) => a.window.from.localeCompare(b.window.from));
    const current = date === today ? currentSlot(all, localTime(now, tz)) : null;
    return {
      date,
      nutrition: { consumed, target: { kcal: t.kcal, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG } },
      meals: all.map((s) => {
        const mine = logs.filter((l) => l.slot === s.slot);
        const kcal = mine.filter((l) => !l.skipped).reduce((a, l) => a + l.kcal, 0);
        const status: SlotStatus = mine.some((l) => !l.skipped) ? 'logged' : mine.some((l) => l.skipped) ? 'skipped' : s.slot === current ? 'current' : 'pending';
        return { slot: s.slot, label: s.label, status, kcal: status === 'logged' ? kcal : null, window: s.window };
      }),
    };
  }

  /** Registra una comida. Si `exec` viene de afuera (modo cocina), corre dentro de esa transacción. */
  async logTx(exec: Executor, userId: string, date: string, input: LogMealInput & { cookingSessionId?: string; adaptedNutrition?: Macros; label?: string }) {
    let label = input.label ?? input.freeText ?? '';
    let nutrition: Macros = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
    const servings = input.servings ?? 1;
    if (input.recipeId) {
      const card = (await this.recipes.cards(userId, [input.recipeId]))[0];
      if (!card) throw Errors.validation([field('recipeId', 'INVALID_OPTION', 'Esa receta no existe.')]);
      label = label || card.title;
      nutrition = scaleMacros(input.adaptedNutrition ?? card.nutritionPerServing, servings);
    } else if (input.nutrition) {
      nutrition = scaleMacros(input.nutrition, input.freeText ? 1 : servings);
    } else if (!input.skipped) {
      throw Errors.validation([field('recipeId', 'REQUIRED', 'Manda recipeId, o freeText con nutrition, o skipped.')]);
    }
    const meal = await this.meals.insert(exec, {
      id: newId('meal'),
      userId,
      localDate: date,
      slot: input.slot,
      recipeId: input.recipeId ?? null,
      label: input.skipped ? 'Saltada' : label,
      servings,
      ...nutrition,
      skipped: input.skipped ?? false,
      source: input.cookingSessionId ? 'cooking' : 'manual',
      cookingSessionId: input.cookingSessionId ?? null,
    });
    await this.outbox.record(exec, 'meal.logged', { userId, mealId: meal.id, localDate: date, slot: input.slot, recipeId: input.recipeId ?? null, source: meal.source as 'manual' | 'cooking' });
    return meal;
  }

  async log(userId: string, date: string, tz: string, input: LogMealInput) {
    this.assertDate(date);
    const meal = await this.db.transaction((tx) => this.logTx(tx, userId, date, input));
    this.outbox.kick();
    return {
      meal: { id: meal.id, slot: meal.slot, label: meal.label, nutrition: { kcal: meal.kcal, proteinG: meal.proteinG, carbsG: meal.carbsG, fatG: meal.fatG } },
      day: await this.summary(userId, date, tz),
    };
  }

  async remove(userId: string, date: string, tz: string, mealId: string) {
    this.assertDate(date);
    await this.db.transaction(async (tx) => {
      const r = await this.meals.delete(tx, userId, date, mealId);
      if (!r) throw Errors.notFound('Ese registro no existe.');
      await this.outbox.record(tx, 'meal.deleted', { userId, mealId, localDate: date });
    });
    this.outbox.kick();
    return { day: await this.summary(userId, date, tz) };
  }
}
