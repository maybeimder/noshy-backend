import type { Outbox } from '../../core/events/outbox.js';
import type { ChefRepository } from './chef.repository.js';
import type { InsightDoc, UserSignalDoc } from '../../infrastructure/database/mongo/collections.js';
import { Errors } from '../../core/shared/errors.js';
import { WEEKDAYS_ES } from '../../core/shared/time.js';

const TAG_ADJ: Record<string, string> = { creamy: 'cremosos', spicy: 'picantes', light: 'ligeros', comfort: 'reconfortantes', fresh: 'frescos', sweet: 'dulces' };
const LEARNING_FULL_AT = 200;

/**
 * Lo que el chef aprendió. Las señales llegan por eventos (cocinar, comprar, calificar)
 * y se convierten en insights con evidencia. El usuario los confirma o descarta.
 */
export class InsightsService {
  constructor(
    private readonly chef: ChefRepository,
    private readonly outbox: Outbox,
  ) {}

  dto(d: InsightDoc) {
    return { id: d._id, text: d.text, confidence: Math.round(d.confidence * 100) / 100, evidence: d.evidence, userVote: d.userVote, status: d.status };
  }

  async list(userId: string, limit = 20, cursor?: string) {
    const skip = cursor ? Number(Buffer.from(cursor, 'base64url').toString()) || 0 : 0;
    const rows = await this.chef.insights(userId, limit, skip);
    const hasMore = rows.length > limit;
    return {
      data: rows.slice(0, limit).map((d) => this.dto(d)),
      meta: { nextCursor: hasMore ? Buffer.from(String(skip + limit)).toString('base64url') : null, limit },
    };
  }

  async vote(userId: string, insightId: string, vote: 'up' | 'down') {
    const existing = await this.chef.insight(userId, insightId);
    if (!existing) throw Errors.notFound('Ese aprendizaje no existe.');
    const updated = await this.chef.voteInsight(userId, insightId, vote);
    await this.outbox.publish('insight.voted', { userId, insightId, vote });
    return { id: insightId, status: updated!.status, userVote: updated!.userVote };
  }

  async learning(userId: string) {
    const [signalsCount, top] = await Promise.all([this.chef.signalsCount(userId), this.chef.insights(userId, 3)]);
    return { score: Math.min(1, Math.round((signalsCount / LEARNING_FULL_AT) * 100) / 100), signalsCount, topInsights: top.slice(0, 3).map((d) => this.dto(d)) };
  }

  async top(userId: string) {
    const [d] = await this.chef.insights(userId, 1);
    return d && d.confidence >= 0.5 ? this.dto(d) : null;
  }

  recordSignal(doc: UserSignalDoc) {
    return this.chef.addSignal(doc);
  }

  /** Recalcula insights a partir de las señales de los últimos 90 días. */
  async rebuild(userId: string) {
    const signals = await this.chef.signals(userId, new Date(Date.now() - 90 * 86_400_000));
    const rejected = await this.chef.rejectedInsightKeys(userId);
    const now = new Date();
    const out: Omit<InsightDoc, '_id' | 'userVote' | 'status'>[] = [];

    // 1) Sabor preferido por día de la semana.
    const cooked = signals.filter((s) => s.kind === 'cooked' && s.weekday !== undefined);
    for (let wd = 0; wd < 7; wd++) {
      const day = cooked.filter((s) => s.weekday === wd);
      if (day.length < 3) continue;
      const tagCount = new Map<string, number>();
      day.forEach((s) => (s.tags ?? []).forEach((t) => TAG_ADJ[t] && tagCount.set(t, (tagCount.get(t) ?? 0) + 1)));
      const best = [...tagCount].sort((a, b) => b[1] - a[1])[0];
      if (!best || best[1] / day.length < 0.5) continue;
      const plural = wd === 0 || wd === 6 ? `Los ${WEEKDAYS_ES[wd]}s` : `Los ${WEEKDAYS_ES[wd]}`;
      out.push({
        userId,
        key: `weekdayFlavor:${wd}:${best[0]}`,
        text: `${plural} prefieres platos ${TAG_ADJ[best[0]]}`,
        confidence: Math.min(0.95, best[1] / (best[1] + 4)),
        evidence: { count: best[1], kind: 'recipes', label: `${best[1]} recetas` },
        updatedAt: now,
      });
    }

    // 2) Cenas ligeras.
    const dinners = signals.filter((s) => s.kind === 'cooked' && s.slot === 'dinner');
    const light = dinners.filter((s) => (s.tags ?? []).includes('light'));
    if (light.length >= 3 && light.length / dinners.length >= 0.6) {
      out.push({
        userId,
        key: 'lightDinners',
        text: 'Prefieres cenas ligeras',
        confidence: Math.min(0.9, light.length / (light.length + 6)),
        evidence: { count: light.length, kind: 'recipes', label: `${light.length} recetas` },
        updatedAt: now,
      });
    }

    // 3) Marcas que compra seguido.
    const brandEvents = new Map<string, Set<string>>();
    signals
      .filter((s) => (s.kind === 'brandPurchased' || s.kind === 'brandSwapped') && s.brand)
      .forEach((s) => brandEvents.set(s.brand!, (brandEvents.get(s.brand!) ?? new Set()).add(s.eventId)));
    const brands = [...brandEvents].filter(([, ev]) => ev.size >= 3).sort((a, b) => b[1].size - a[1].size).slice(0, 2);
    if (brands.length) {
      const receipts = new Set(brands.flatMap(([, ev]) => [...ev])).size;
      out.push({
        userId,
        key: `brands:${brands.map(([b]) => b).join('|')}`,
        text: `Compras ${brands.map(([b]) => b).join(' y ')} con frecuencia`,
        confidence: Math.min(0.95, receipts / (receipts + 2)),
        evidence: { count: receipts, kind: 'receipts', label: `${receipts} facturas` },
        updatedAt: now,
      });
    }

    for (const i of out) if (!rejected.has(i.key)) await this.chef.upsertInsight(i);
    return out.length;
  }
}
