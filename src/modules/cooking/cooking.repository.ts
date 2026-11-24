import { and, desc, eq, gte, lt, ne, sql } from 'drizzle-orm';
import type { Db, Executor } from '../../infrastructure/database/postgres/postgres.client.js';
import { cookingSessions, media, recipes } from '../../infrastructure/database/postgres/schema.js';
import type { MongoCollections, CookingEventDoc } from '../../infrastructure/database/mongo/collections.js';

export type CookingSessionRow = typeof cookingSessions.$inferSelect;

export class CookingRepository {
  constructor(
    private readonly db: Db,
    private readonly mongo: MongoCollections,
  ) {}

  async insert(exec: Executor, row: typeof cookingSessions.$inferInsert) {
    const [r] = await exec.insert(cookingSessions).values(row).returning();
    return r!;
  }

  async byId(userId: string, id: string, exec: Executor = this.db) {
    const [r] = await exec.select().from(cookingSessions).where(and(eq(cookingSessions.userId, userId), eq(cookingSessions.id, id)));
    return r ?? null;
  }

  async active(userId: string) {
    const [r] = await this.db
      .select()
      .from(cookingSessions)
      .where(and(eq(cookingSessions.userId, userId), eq(cookingSessions.status, 'active')))
      .orderBy(desc(cookingSessions.startedAt))
      .limit(1);
    return r ?? null;
  }

  async update(exec: Executor, id: string, patch: Partial<typeof cookingSessions.$inferInsert>) {
    const [r] = await exec.update(cookingSessions).set(patch).where(eq(cookingSessions.id, id)).returning();
    return r!;
  }

  /** Cierra sesiones activas viejas (las llama el scheduler). */
  async abandonStale(olderThan: Date) {
    return this.db
      .update(cookingSessions)
      .set({ status: 'abandoned', abandonedReason: 'stale', finishedAt: new Date() })
      .where(and(eq(cookingSessions.status, 'active'), lt(cookingSessions.startedAt, olderThan)))
      .returning({ id: cookingSessions.id, userId: cookingSessions.userId, recipeId: cookingSessions.recipeId, currentStepIndex: cookingSessions.currentStepIndex });
  }

  async timesCooked(userId: string, recipeId: string, exec: Executor = this.db) {
    const [r] = await exec
      .select({ n: sql<number>`count(*)::int` })
      .from(cookingSessions)
      .where(and(eq(cookingSessions.userId, userId), eq(cookingSessions.recipeId, recipeId), eq(cookingSessions.status, 'completed')));
    return r?.n ?? 0;
  }

  async countsSince(userId: string, since: Date) {
    const rows = await this.db
      .select({ recipeId: cookingSessions.recipeId, n: sql<number>`count(*)::int` })
      .from(cookingSessions)
      .where(and(eq(cookingSessions.userId, userId), eq(cookingSessions.status, 'completed'), gte(cookingSessions.finishedAt, since)))
      .groupBy(cookingSessions.recipeId);
    return new Map(rows.map((r) => [r.recipeId, r.n]));
  }

  async completedCount(userId: string, exec: Executor = this.db) {
    const [r] = await exec
      .select({ n: sql<number>`count(*)::int` })
      .from(cookingSessions)
      .where(and(eq(cookingSessions.userId, userId), eq(cookingSessions.status, 'completed')));
    return r?.n ?? 0;
  }

  async completedLocalDates(userId: string, since: Date, exec: Executor = this.db) {
    const rows = await exec
      .select({ d: cookingSessions.localDate })
      .from(cookingSessions)
      .where(and(eq(cookingSessions.userId, userId), eq(cookingSessions.status, 'completed'), gte(cookingSessions.finishedAt, since)));
    return rows.map((r) => r.d).filter((d): d is string => !!d);
  }

  /** «Mi cocina»: recetas cocinadas, agrupadas, con conteo y última vez. Pocas por usuario: se pagina en memoria. */
  async cooked(userId: string) {
    return this.db
      .select({
        recipeId: cookingSessions.recipeId,
        title: recipes.title,
        imageUrl: recipes.imageUrl,
        timeMax: recipes.timeMax,
        timesCooked: sql<number>`count(*)::int`,
        lastCookedAt: sql<string>`max(${cookingSessions.finishedAt})`,
        /** Su foto más reciente de ese plato. */
        photoKey: sql<string | null>`(array_agg(${media.storageKey} order by ${cookingSessions.finishedAt} desc) filter (where ${media.storageKey} is not null))[1]`,
      })
      .from(cookingSessions)
      .innerJoin(recipes, eq(recipes.id, cookingSessions.recipeId))
      .leftJoin(media, and(eq(media.id, cookingSessions.photoMediaId), eq(media.userId, userId), ne(media.status, 'pending')))
      .where(and(eq(cookingSessions.userId, userId), eq(cookingSessions.status, 'completed')))
      .groupBy(cookingSessions.recipeId, recipes.title, recipes.imageUrl, recipes.timeMax);
  }

  // ---------- Eventos (Mongo) ----------
  async insertEvents(docs: CookingEventDoc[]): Promise<number> {
    if (docs.length === 0) return 0;
    let accepted = 0;
    for (const d of docs) {
      const r = await this.mongo.cookingEvents.updateOne({ _id: d._id }, { $setOnInsert: d }, { upsert: true });
      if (r.upsertedCount) accepted++;
    }
    return accepted;
  }
}
