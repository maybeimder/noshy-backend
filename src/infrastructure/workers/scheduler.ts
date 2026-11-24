import { and, gt, isNotNull, lte, sql } from 'drizzle-orm';
import type { Container } from '../../container.js';
import { pantryItems, users } from '../database/postgres/schema.js';
import { addDays, localDate } from '../../core/shared/time.js';

const SCHEDULER_LOCK = 724_001;
/** Aparte: estimar recetas tarda minutos y no debe frenar las demás tareas. */
const LIBRARY_LOCK = 724_002;
const STALE_SESSION_HOURS = 6;

/**
 * Tareas periódicas. Un advisory lock de Postgres garantiza que solo una instancia las corra.
 * - Avisos de vencimiento para usuarios con ingredientes que vencen pronto.
 * - Recetas de la biblioteca con macros estimados, de a pocas por hora hasta `LIBRARY_RECIPES_TARGET`.
 * - Cierre de sesiones de cocina abandonadas (emite `cooking.abandoned`).
 */
export class Scheduler {
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly c: Container) {}

  start() {
    this.timers.push(setInterval(() => void this.run('nudges', () => this.refreshExpiringNudges()), 60 * 60_000));
    this.timers.push(setInterval(() => void this.run('staleSessions', () => this.closeStaleSessions()), 15 * 60_000));
    if (this.c.env.LIBRARY_RECIPES_TARGET > 0 && this.c.services.recipeLibrary.enabled) {
      const job = () => void this.run('library', async () => void (await this.c.services.recipeLibrary.importBatch(this.c.env.LIBRARY_RECIPES_TARGET)), LIBRARY_LOCK);
      this.timers.push(setTimeout(job, 60_000), setInterval(job, 60 * 60_000));
    }
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  private async run(name: string, fn: () => Promise<void>, lock = SCHEDULER_LOCK) {
    const client = await this.c.pg.pool.connect();
    try {
      const { rows } = await client.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [lock]);
      if (!rows[0]?.ok) return;
      try {
        await this.c.services.catalog.sync();
        await fn();
      } finally {
        await client.query('select pg_advisory_unlock($1)', [lock]);
      }
    } catch (err) {
      this.c.log.error({ err, job: name }, 'tarea programada falló');
    } finally {
      client.release();
    }
  }

  async refreshExpiringNudges() {
    const soon = addDays(localDate(new Date(), 'UTC'), 2);
    const rows = await this.c.pg.db
      .selectDistinct({ userId: pantryItems.userId, tz: users.timezone })
      .from(pantryItems)
      .innerJoin(users, sql`${users.id} = ${pantryItems.userId}`)
      .where(and(isNotNull(pantryItems.expiresOn), lte(pantryItems.expiresOn, soon), gt(sql`coalesce(${pantryItems.remainingPct}, 100)`, 0)));
    for (const r of rows) {
      const prefs = await this.c.repos.preferences.get(r.userId);
      if (prefs) await this.c.services.nudges.refresh(r.userId, r.tz, prefs.kitchen.mealsPerDay).catch((err) => this.c.log.warn({ err }, 'nudges'));
    }
  }

  async closeStaleSessions() {
    const closed = await this.c.repos.cooking.abandonStale(new Date(Date.now() - STALE_SESSION_HOURS * 3_600_000));
    for (const s of closed) {
      await this.c.outbox.publish('cooking.abandoned', { userId: s.userId, sessionId: s.id, recipeId: s.recipeId, atStepIndex: s.currentStepIndex, reason: 'stale' });
    }
  }
}
