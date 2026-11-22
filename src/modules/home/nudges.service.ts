import { and, eq, gte } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/postgres/postgres.client.js';
import type { Outbox } from '../../core/events/outbox.js';
import type { NudgesRepository, NudgeRow } from './nudges.repository.js';
import type { PantryRepository } from '../pantry/pantry.repository.js';
import type { RecommendationsService } from '../recipes/recommendations.service.js';
import { cookingSessions } from '../../infrastructure/database/postgres/schema.js';
import { Errors } from '../../core/shared/errors.js';
import { newId } from '../../core/shared/ids.js';
import { addDays, localDate, localTime } from '../../core/shared/time.js';
import { currentSlot, slotsFor } from '../../core/domain/meal-slots.js';

const PROTEIN_SHORT: Record<string, { word: string; emoji: string; alternative: string }> = {
  ing_chickenbreast: { word: 'pollo', emoji: '🍗', alternative: 'un pescado' },
  ing_groundbeef: { word: 'carne', emoji: '🥩', alternative: 'unas lentejas' },
  ing_beefsteak: { word: 'res', emoji: '🥩', alternative: 'un pescado' },
  ing_pork: { word: 'cerdo', emoji: '🥓', alternative: 'un pollo al horno' },
};
const VARIETY_THRESHOLD = 5;
const SLOT_WORD: Record<string, string> = { breakfast: 'el desayuno', snack1: 'el snack', lunch: 'el almuerzo', snack2: 'el snack', dinner: 'la cena' };

/** Avisos del chef. Se recalculan por eventos (despensa, cocina) y por el scheduler. */
export class NudgesService {
  constructor(
    private readonly db: Db,
    private readonly repo: NudgesRepository,
    private readonly pantry: PantryRepository,
    private readonly recommendations: RecommendationsService,
    private readonly outbox: Outbox,
  ) {}

  dto(n: NudgeRow) {
    return { id: n.id, kind: n.kind, placement: n.placement, title: n.title, body: n.body, action: n.action, expiresAt: n.expiresAt.toISOString() };
  }

  async list(userId: string, placement: string) {
    const rows = await this.repo.active(userId, placement);
    return rows.slice(0, 1).map((r) => this.dto(r));
  }

  async dismiss(userId: string, nudgeId: string, reason: 'dismissed' | 'acted') {
    const n = await this.repo.dismiss(userId, nudgeId, reason);
    if (!n) throw Errors.notFound('Ese aviso no existe.');
    await this.outbox.publish('nudge.dismissed', { userId, nudgeId, kind: n.kind, reason });
  }

  async refresh(userId: string, tz: string, mealsPerDay = 3) {
    await Promise.all([this.refreshExpiring(userId, tz, mealsPerDay), this.refreshVariety(userId, tz)]);
  }

  private async refreshExpiring(userId: string, tz: string, mealsPerDay: number) {
    const today = localDate(new Date(), tz);
    const [first] = await this.pantry.expiringBefore(userId, addDays(today, 1), 1);
    if (!first?.expiresOn) return;
    const slot = currentSlot(slotsFor(mealsPerDay), localTime(new Date(), tz)) ?? 'lunch';
    const ideas = await this.recommendations.ranked(userId, { usingIngredientIds: [first.ingredientId], slot });
    if (ideas.length === 0) return;
    const label = first.label.toLowerCase();
    const when = first.expiresOn <= today ? 'hoy' : 'mañana';
    const n = Math.min(ideas.length, 3);
    await this.repo.upsert({
      id: newId('nudge'),
      userId,
      kind: 'expiringIngredient',
      placement: 'home',
      title: `Tu ${label} vence ${when}`,
      body: `Tengo ${n} ${n === 1 ? 'idea' : 'ideas'} para ${SLOT_WORD[slot] ?? 'hoy'}`,
      action: { type: 'openRecommendations', filters: { usingIngredientIds: [first.ingredientId], slot } },
      dedupeKey: `expiring:${first.ingredientId}:${first.expiresOn}`,
      expiresAt: new Date(`${first.expiresOn}T23:59:59Z`),
    });
  }

  private async refreshVariety(userId: string, tz: string) {
    const today = localDate(new Date(), tz);
    const monthStart = `${today.slice(0, 8)}01`;
    const sessions = await this.db
      .select({ usage: cookingSessions.ingredientUsage })
      .from(cookingSessions)
      .where(and(eq(cookingSessions.userId, userId), eq(cookingSessions.status, 'completed'), gte(cookingSessions.localDate, monthStart)));
    const counts = new Map<string, number>();
    for (const s of sessions) {
      for (const id of new Set(s.usage.map((u) => u.ingredientId))) if (PROTEIN_SHORT[id]) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const top = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (!top || top[1] < VARIETY_THRESHOLD) return;
    const p = PROTEIN_SHORT[top[0]]!;
    const endOfMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0, 23, 59, 59));
    await this.repo.upsert({
      id: newId('nudge'),
      userId,
      kind: 'variety',
      placement: 'myKitchen',
      title: `Este mes repetiste ${p.word} ${top[1]} veces ${p.emoji}`,
      body: `¿Probamos ${p.alternative} el jueves?`,
      action: { type: 'openChef', prompt: `Recomiéndame ${p.alternative} para el jueves` },
      dedupeKey: `variety:${top[0]}:${monthStart}`,
      expiresAt: endOfMonth,
    });
  }
}
