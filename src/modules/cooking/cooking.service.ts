import type { Db } from '../../infrastructure/database/postgres/postgres.client.js';
import type { Outbox } from '../../core/events/outbox.js';
import type { CookingRepository, CookingSessionRow } from './cooking.repository.js';
import type { RecipesRepository } from '../recipes/recipes.repository.js';
import type { MediaRepository } from '../media/media.repository.js';
import type { RecipesService } from '../recipes/recipes.service.js';
import type { PantryService } from '../pantry/pantry.service.js';
import type { DaysService } from '../home/days.service.js';
import { streakWeeks } from '../../core/domain/streak.js';
import type { MealSlotId } from '../../core/domain/catalog.js';
import type { Unit } from '../../core/domain/quantity.js';
import { Errors, field } from '../../core/shared/errors.js';
import { newId } from '../../core/shared/ids.js';
import { localDate, localWeekday } from '../../core/shared/time.js';

const HEAT_SCALE = { min: 0, max: 9, marks: [{ level: 1, label: 'Bajo' }, { level: 5, label: 'Medio' }, { level: 9, label: 'Alto' }] };
const VOICE = { commands: ['siguiente', 'atrás', 'repite', 'pausa', 'más tiempo'] };
const LIGHT_KCAL = 550;

export type CookingEventInput =
  | { type: 'stepEntered'; stepIndex: number; at: string }
  | { type: 'subStepStarted' | 'timerPaused' | 'timerResumed' | 'heatChangeAcknowledged'; stepIndex: number; subStepIndex: number; at: string }
  | { type: 'timerExtended'; stepIndex: number; subStepIndex: number; addedSeconds: number; at: string }
  | { type: 'voiceCommand'; command: string; at: string }
  | { type: 'speechToggled'; enabled: boolean; at: string };

/**
 * Modo cocina. El backend entrega la receta estructurada al empezar y el timer vive en el front.
 * Al terminar, en una transacción: registra la comida, descuenta la despensa y emite `cooking.completed`.
 */
export class CookingService {
  constructor(
    private readonly db: Db,
    private readonly repo: CookingRepository,
    private readonly recipesRepo: RecipesRepository,
    private readonly media: MediaRepository,
    private readonly recipes: RecipesService,
    private readonly pantry: PantryService,
    private readonly days: DaysService,
    private readonly outbox: Outbox,
  ) {}

  dto(s: CookingSessionRow, title: string) {
    return {
      id: s.id,
      recipe: { id: s.recipeId, title },
      servings: s.servings,
      status: s.status,
      currentStepIndex: s.currentStepIndex,
      heatScale: HEAT_SCALE,
      voice: VOICE,
      steps: s.steps,
      startedAt: s.startedAt.toISOString(),
    };
  }

  async start(userId: string, input: { recipeId: string; servings: number; adaptationId?: string | null; mealSlot?: MealSlotId }) {
    const active = await this.repo.active(userId);
    if (active) throw Errors.conflict('SESSION_ALREADY_ACTIVE', 'Ya tienes una receta en curso.', { sessionId: active.id });
    const r = await this.recipes.resolvedFor(userId, input.recipeId, input.servings, input.adaptationId ?? null);
    if (!r.evaluated.evaluation.compatibility.ok)
      throw Errors.unprocessable('RECIPE_NOT_COMPATIBLE', 'Esta receta choca con tus restricciones y no la pudimos adaptar.', { conflicts: r.evaluated.evaluation.compatibility.conflicts });
    const steps = this.recipes.cookingSteps(r.recipe, r.rows, r.adaptation, r.factor);
    const session = await this.db.transaction(async (tx) => {
      const s = await this.repo.insert(tx, {
        id: newId('cookingSession'),
        userId,
        recipeId: r.recipe.id,
        adaptationId: r.adaptation?.id ?? null,
        servings: input.servings,
        mealSlot: input.mealSlot ?? null,
        status: 'active',
        steps,
        ingredientUsage: r.ingredients.map((i) => ({ ingredientId: i.ingredientId, value: i.value, unit: i.unit })),
      });
      await this.outbox.record(tx, 'cooking.started', { userId, sessionId: s.id, recipeId: r.recipe.id });
      return s;
    });
    this.outbox.kick();
    return this.dto(session, r.recipe.title);
  }

  private async sessionOrThrow(userId: string, id: string) {
    const s = await this.repo.byId(userId, id);
    if (!s) throw Errors.notFound('Esa sesión de cocina no existe.');
    return s;
  }

  async get(userId: string, id: string) {
    const s = await this.sessionOrThrow(userId, id);
    const r = await this.recipesRepo.byId(s.recipeId);
    return this.dto(s, r?.title ?? '');
  }

  async active(userId: string) {
    const s = await this.repo.active(userId);
    if (!s) return null;
    const r = await this.recipesRepo.byId(s.recipeId);
    return { id: s.id, recipe: { id: s.recipeId, title: r?.title ?? '', imageUrl: r?.imageUrl ?? null }, currentStepIndex: s.currentStepIndex, stepsCount: s.steps.length, startedAt: s.startedAt.toISOString() };
  }

  async recordEvents(userId: string, id: string, events: CookingEventInput[]) {
    const s = await this.sessionOrThrow(userId, id);
    if (s.status !== 'active') throw Errors.conflict('SESSION_NOT_ACTIVE', 'Esa sesión ya terminó.');
    const now = new Date();
    const docs = events.map((e) => {
      const stepIndex = 'stepIndex' in e ? e.stepIndex : undefined;
      const subStepIndex = 'subStepIndex' in e ? e.subStepIndex : undefined;
      return {
        _id: [s.id, e.type, stepIndex ?? '', subStepIndex ?? '', e.at].join('|'),
        sessionId: s.id,
        userId,
        type: e.type,
        stepIndex,
        subStepIndex,
        addedSeconds: e.type === 'timerExtended' ? e.addedSeconds : undefined,
        command: e.type === 'voiceCommand' ? e.command : undefined,
        enabled: e.type === 'speechToggled' ? e.enabled : undefined,
        at: new Date(e.at),
        receivedAt: now,
      };
    });
    const accepted = await this.repo.insertEvents(docs);
    const entered = events.filter((e) => e.type === 'stepEntered' || e.type === 'subStepStarted').map((e) => ('stepIndex' in e ? e.stepIndex : 0));
    const current = entered.length ? Math.min(Math.max(...entered), s.steps.length - 1) : s.currentStepIndex;
    const extensions = events.filter((e): e is Extract<CookingEventInput, { type: 'timerExtended' }> => e.type === 'timerExtended');
    await this.db.transaction(async (tx) => {
      if (current !== s.currentStepIndex) await this.repo.update(tx, s.id, { currentStepIndex: current });
      if (accepted > 0) {
        await this.outbox.record(tx, 'cooking.events_recorded', { userId, sessionId: s.id, timerExtensions: extensions.map((e) => ({ stepIndex: e.stepIndex, addedSeconds: e.addedSeconds })) });
      }
    });
    this.outbox.kick();
    return { accepted, currentStepIndex: current };
  }

  async complete(
    userId: string,
    tz: string,
    id: string,
    input: {
      finishedAt: string;
      logMeal: { slot: MealSlotId; servingsEaten: number } | null;
      rating?: number;
      photoMediaId?: string | null;
      pantryCorrections?: { itemId: string; remainingPct: number }[];
    },
  ) {
    const s = await this.sessionOrThrow(userId, id);
    if (s.status !== 'active') throw Errors.conflict('SESSION_NOT_ACTIVE', 'Esa sesión ya terminó.');
    if (input.photoMediaId && !(await this.media.ownedUploaded(userId, input.photoMediaId)))
      throw Errors.validation([field('photoMediaId', 'INVALID_OPTION', 'Esa foto no existe o no terminó de subir.')]);
    const finishedAt = new Date(input.finishedAt);
    const date = localDate(finishedAt, tz);
    const recipe = (await this.recipesRepo.byId(s.recipeId))!;
    const card = (await this.recipes.cards(userId, [s.recipeId]))[0];
    const kcal = card?.nutritionPerServing.kcal ?? 0;

    const result = await this.db.transaction(async (tx) => {
      await this.repo.update(tx, s.id, { status: 'completed', finishedAt, rating: input.rating ?? null, photoMediaId: input.photoMediaId ?? null, localDate: date });
      const meal = input.logMeal
        ? await this.days.logTx(tx, userId, date, {
            slot: input.logMeal.slot,
            recipeId: s.recipeId,
            servings: input.logMeal.servingsEaten,
            cookingSessionId: s.id,
          })
        : null;
      const usage = s.ingredientUsage.map((u) => ({ ingredientId: u.ingredientId, value: u.value, unit: u.unit as Unit }));
      const pantryUpdates = await this.pantry.consume(tx, userId, s.id, usage, input.pantryCorrections ?? []);
      if (input.rating) await this.recipesRepo.addRating(tx, s.recipeId, input.rating);
      if (input.photoMediaId) await this.media.attach(tx, input.photoMediaId);
      const tags = [...recipe.flavorTags, ...(kcal > 0 && kcal < LIGHT_KCAL ? ['light'] : [])];
      await this.outbox.record(tx, 'cooking.completed', {
        userId,
        sessionId: s.id,
        recipeId: s.recipeId,
        rating: input.rating ?? null,
        localDate: date,
        weekday: localWeekday(finishedAt, tz),
        slot: input.logMeal?.slot ?? s.mealSlot ?? null,
        tags,
      });
      const day = await this.days.summary(userId, date, tz, tx);
      const timesCooked = await this.repo.timesCooked(userId, s.recipeId, tx);
      const cookedCount = await this.repo.completedCount(userId, tx);
      const dates = await this.repo.completedLocalDates(userId, new Date(Date.now() - 400 * 86_400_000), tx);
      return { meal, day, pantryUpdates, timesCooked, cookedCount, streak: streakWeeks(dates, localDate(new Date(), tz)) };
    });
    this.outbox.kick();
    return {
      meal: result.meal
        ? { id: result.meal.id, slot: result.meal.slot, nutrition: { kcal: result.meal.kcal, proteinG: result.meal.proteinG, carbsG: result.meal.carbsG, fatG: result.meal.fatG } }
        : null,
      day: result.day,
      pantryUpdates: result.pantryUpdates,
      timesCooked: result.timesCooked,
      stats: { cookedCount: result.cookedCount, streakWeeks: result.streak },
    };
  }

  async abandon(userId: string, id: string, input: { atStepIndex: number; reason?: string | null }) {
    const s = await this.sessionOrThrow(userId, id);
    if (s.status !== 'active') throw Errors.conflict('SESSION_NOT_ACTIVE', 'Esa sesión ya terminó.');
    await this.db.transaction(async (tx) => {
      await this.repo.update(tx, s.id, { status: 'abandoned', finishedAt: new Date(), abandonedReason: input.reason ?? null, currentStepIndex: input.atStepIndex });
      await this.outbox.record(tx, 'cooking.abandoned', { userId, sessionId: s.id, recipeId: s.recipeId, atStepIndex: input.atStepIndex, reason: input.reason ?? null });
    });
    this.outbox.kick();
  }
}
