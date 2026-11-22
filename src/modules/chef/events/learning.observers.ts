import type { Container } from '../../../container.js';
import { EventObserver, type ReplayableObserver } from '../../../core/events/observer.js';

/**
 * Señales de aprendizaje: cada hecho relevante queda como señal en Mongo y se recalculan los insights.
 * Es la única puerta de entrada al «Lo que tu chef ha aprendido».
 *
 * Es una proyección: `pnpm events:replay -- --observer learning --reset` borra las señales y las
 * reconstruye desde el event store (los votos del usuario sobre los insights se conservan).
 */
export class LearningObserver extends EventObserver implements ReplayableObserver {
  readonly name = 'learning';
  readonly replayable = true as const;

  constructor(private readonly c: Container) {
    super();
    const insights = c.services.insights;

    this.on('cooking.completed', async (e) => {
      const p = e.payload;
      await insights.recordSignal({ userId: p.userId, kind: 'cooked', at: e.occurredAt, weekday: p.weekday, slot: p.slot ?? undefined, recipeId: p.recipeId, tags: [...p.tags], eventId: e.id });
      if (p.rating) await insights.recordSignal({ userId: p.userId, kind: 'rated', at: e.occurredAt, recipeId: p.recipeId, value: p.rating, eventId: e.id });
      await insights.rebuild(p.userId);
    });

    this.on('receipt.parsed', async (e) => {
      for (const brand of e.payload.brands) {
        await insights.recordSignal({ userId: e.payload.userId, kind: 'brandPurchased', at: e.occurredAt, brand, eventId: e.id });
      }
      await insights.rebuild(e.payload.userId);
    });

    this.on('shopping.item_swapped', async (e) => {
      await insights.recordSignal({ userId: e.payload.userId, kind: 'brandSwapped', at: e.occurredAt, brand: e.payload.brand, eventId: e.id });
      await insights.rebuild(e.payload.userId);
    });

    this.on('chef.feedback_given', async (e) => {
      await insights.recordSignal({ userId: e.payload.userId, kind: 'ideaFeedback', at: e.occurredAt, recipeId: e.payload.recipeId ?? undefined, value: e.payload.rating === 'up' ? 1 : -1, eventId: e.id });
    });

    this.on('recipe.liked', async (e) => {
      await insights.recordSignal({ userId: e.payload.userId, kind: 'liked', at: e.occurredAt, recipeId: e.payload.recipeId, value: e.payload.liked ? 1 : -1, eventId: e.id });
    });

    this.on('meal.logged', async (e) => {
      await insights.recordSignal({ userId: e.payload.userId, kind: 'mealLogged', at: e.occurredAt, slot: e.payload.slot, recipeId: e.payload.recipeId ?? undefined, eventId: e.id });
    });

    this.on('cooking.events_recorded', async (e) => {
      for (const ext of e.payload.timerExtensions) {
        await insights.recordSignal({ userId: e.payload.userId, kind: 'timerExtended', at: e.occurredAt, value: ext.addedSeconds, eventId: `${e.id}:${ext.stepIndex}` });
      }
    });
  }

  async reset(streamId?: string) {
    await this.c.mongo.c.userSignals.deleteMany(streamId ? { userId: streamId } : {});
  }
}
