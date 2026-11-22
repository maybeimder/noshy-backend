import { and, eq, gt, isNull, desc } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/postgres/postgres.client.js';
import { nudges } from '../../infrastructure/database/postgres/schema.js';

export type NudgeRow = typeof nudges.$inferSelect;

export class NudgesRepository {
  constructor(private readonly db: Db) {}

  async active(userId: string, placement: string, now = new Date()) {
    return this.db
      .select()
      .from(nudges)
      .where(and(eq(nudges.userId, userId), eq(nudges.placement, placement), isNull(nudges.dismissedAt), gt(nudges.expiresAt, now)))
      .orderBy(desc(nudges.createdAt));
  }

  async byId(userId: string, id: string) {
    const [r] = await this.db.select().from(nudges).where(and(eq(nudges.userId, userId), eq(nudges.id, id)));
    return r ?? null;
  }

  /** Crea o refresca un aviso por `dedupeKey`; si el usuario ya lo descartó, no vuelve a aparecer. */
  async upsert(row: typeof nudges.$inferInsert) {
    await this.db
      .insert(nudges)
      .values(row)
      .onConflictDoUpdate({ target: [nudges.userId, nudges.dedupeKey], set: { title: row.title, body: row.body, action: row.action, expiresAt: row.expiresAt } });
  }

  async dismiss(userId: string, id: string, reason: string) {
    const [r] = await this.db
      .update(nudges)
      .set({ dismissedAt: new Date(), dismissReason: reason })
      .where(and(eq(nudges.userId, userId), eq(nudges.id, id)))
      .returning();
    return r ?? null;
  }
}
