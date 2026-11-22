import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db, Executor } from '../../infrastructure/database/postgres/postgres.client.js';
import { dataExports, emailVerifications, recipes } from '../../infrastructure/database/postgres/schema.js';
import type { MongoCollections } from '../../infrastructure/database/mongo/collections.js';

export class AccountRepository {
  constructor(
    private readonly db: Db,
    private readonly mongo: MongoCollections,
  ) {}

  async insertVerification(exec: Executor, row: typeof emailVerifications.$inferInsert) {
    await exec.insert(emailVerifications).values(row);
  }

  async latestVerification(userId: string) {
    const [r] = await this.db
      .select()
      .from(emailVerifications)
      .where(and(eq(emailVerifications.userId, userId), isNull(emailVerifications.consumedAt)))
      .orderBy(desc(emailVerifications.createdAt))
      .limit(1);
    return r ?? null;
  }

  async verificationById(id: string) {
    const [r] = await this.db.select().from(emailVerifications).where(eq(emailVerifications.id, id));
    return r ?? null;
  }

  async bumpAttempts(id: string) {
    const [r] = await this.db.select({ a: emailVerifications.attempts }).from(emailVerifications).where(eq(emailVerifications.id, id));
    await this.db.update(emailVerifications).set({ attempts: (r?.a ?? 0) + 1 }).where(eq(emailVerifications.id, id));
  }

  async consumeVerification(exec: Executor, id: string) {
    await exec.update(emailVerifications).set({ consumedAt: new Date() }).where(eq(emailVerifications.id, id));
  }

  async insertExport(row: typeof dataExports.$inferInsert) {
    const [r] = await this.db.insert(dataExports).values(row).returning();
    return r!;
  }

  async exportById(userId: string, id: string) {
    const [r] = await this.db.select().from(dataExports).where(and(eq(dataExports.userId, userId), eq(dataExports.id, id)));
    return r ?? null;
  }

  async updateExport(id: string, patch: Partial<typeof dataExports.$inferInsert>) {
    await this.db.update(dataExports).set(patch).where(eq(dataExports.id, id));
  }

  /** Las recetas publicadas quedan anónimas y retiradas: otros usuarios las referencian (comidas, sesiones). */
  async retireAuthoredRecipes(exec: Executor, userId: string) {
    await exec.update(recipes).set({ authorId: null, status: 'removed', updatedAt: new Date() }).where(eq(recipes.authorId, userId));
  }

  /** Borra todo lo del usuario en Mongo. */
  async purgeMongo(userId: string) {
    const c = this.mongo;
    await Promise.all([
      c.chefThreads.deleteMany({ userId }),
      c.chefMessages.deleteMany({ userId }),
      c.cookingEvents.deleteMany({ userId }),
      c.userSignals.deleteMany({ userId }),
      c.insights.deleteMany({ userId }),
      c.receiptScans.deleteMany({ userId }),
    ]);
  }

  async mongoExport(userId: string) {
    const c = this.mongo;
    const [threads, messages, signals, insights] = await Promise.all([
      c.chefThreads.find({ userId }).toArray(),
      c.chefMessages.find({ userId }).toArray(),
      c.userSignals.find({ userId }).toArray(),
      c.insights.find({ userId }).toArray(),
    ]);
    return { chefThreads: threads, chefMessages: messages, learningSignals: signals, insights };
  }
}
